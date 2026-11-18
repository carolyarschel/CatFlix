import { env } from '../../config/env';
import { omdbConfig, tmdbConfig } from '../../config/metadata';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import {
  ObservadorDeTransporte,
  checarPreEstreias,
  checarSemantica,
  checarTaxaDeMatch,
  registrarContratoOk,
  registrarQuebraDeContrato,
} from '../canaries';
import { ContractError } from '../../shared/errors';
import { aplicarDecisao, atualizarNotas, upsertPorTmdbId } from '../catalog';
import {
  encerrarDisponibilidadeAusente,
  marcarDisponibilidade,
  sincronizarCinemas,
  sincronizarSessoes,
} from '../cinemas';
import {
  IngressoClient,
  minutosDeDuracao,
  normalizarCinema,
  normalizarSessoes,
  type RawEvent,
  type RawShowtimeMovie,
} from '../ingresso';
import { decidirERegistrar, FontesDeProducao } from '../matching';
import type { EventoParaMatching } from '../matching';
import { OmdbClient, cotaDoOmdb, precisaAtualizarNotas } from '../omdb';
import { recalcularTodasAsTagsAuto } from '../tags';
import { TmdbClient, normalizarMetadata, precisaAtualizarMetadata } from '../tmdb';
import type { ContextoDoJob } from './sync.runs';

const log = logger.child({ module: 'sync:jobs' });

/**
 * Teto por execução, além da cota diária: o job roda uma vez por dia, e a cota
 * de 24 h pode estar quase inteira livre — este número limita a rajada.
 */
const MAX_NOTAS_POR_EXECUCAO = 200;

function paraLista(valor: string | null | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(/[,;|]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

function eventoDoIngresso(filme: RawShowtimeMovie | RawEvent): EventoParaMatching {
  const comCreditos = filme as RawEvent;
  return {
    ingressoEventId: filme.id,
    title: filme.title,
    originalTitle: filme.originalTitle ?? null,
    year: filme.releaseYear ?? null,
    runtimeMinutes: minutosDeDuracao(filme.duration),
    distributor: filme.distributor ?? null,
    siteUrl: filme.siteURL ?? null,
    directorNames: paraLista(comCreditos.director ?? comCreditos.directors),
    castNames: paraLista(comCreditos.cast),
  };
}

/**
 * Casa cada evento e o materializa no catálogo.
 *
 * Reaproveita a metadata que o matching já abriu no TMDB — sem isso o sync
 * buscaria o mesmo filme duas vezes.
 */
async function resolverEventos(
  eventos: Map<string, EventoParaMatching>,
  fontes: FontesDeProducao,
  ctx: ContextoDoJob,
): Promise<Map<string, string>> {
  const titleIdPorEvento = new Map<string, string>();

  for (const evento of eventos.values()) {
    try {
      const { decisao } = await decidirERegistrar(evento, { fontes, syncRunId: ctx.syncRunId });

      const metadata = decisao.candidateTmdbId
        ? fontes.metadataDoCandidato(decisao.candidateTmdbId)
        : undefined;

      const r = await aplicarDecisao(evento, decisao, metadata ? { metadata } : {});
      titleIdPorEvento.set(evento.ingressoEventId, r.titleId);

      if (r.criouTitle) ctx.contagens.newCount += 1;
      if (decisao.outcome === 'accepted') ctx.contagens.matchedCount += 1;
      if (r.abriuPendencia) ctx.contagens.reviewCount += 1;
    } catch (erro) {
      // um evento problemático não pode derrubar o sync inteiro: conta como
      // erro (o SyncRun fecha como `partial`) e segue
      ctx.contagens.errorCount += 1;
      log.error('falha ao resolver evento', { evento: evento.ingressoEventId, titulo: evento.title, erro });
    }
  }

  return titleIdPorEvento;
}

/**
 * Job principal (§9, 3× ao dia): cinemas → sessões → matching → catálogo →
 * disponibilidade → tags.
 *
 * Idempotente de ponta a ponta. Rodando duas vezes seguidas, o estágio 0 do
 * matching resolve tudo pelo cache e nenhuma requisição vai ao TMDB.
 */
export async function jobSessoes(ctx: ContextoDoJob): Promise<void> {
  const cityId = env.INGRESSO_CITY_ID;
  if (!cityId) throw new Error('INGRESSO_CITY_ID não está configurada.');

  // canary de TRANSPORTE: acumula o que o cliente HTTP vê e resume no fim
  const transporte = new ObservadorDeTransporte(ctx.syncRunId);
  const cliente = new IngressoClient({
    syncRunId: ctx.syncRunId,
    onTransportEvent: (e) => transporte.observar(e),
  });
  const fontes = new FontesDeProducao({ syncRunId: ctx.syncRunId });

  try {
    await executarSessoes(ctx, cityId, cliente, fontes);
  } catch (erro) {
    // canary de CONTRATO: payload que não bate com o zod é categoria própria.
    // Não é "a API caiu" — é "a API mudou", e o catálogo parou de ser
    // atualizado por aquela fonte até alguém olhar (§7.1).
    if (erro instanceof ContractError) {
      await registrarQuebraDeContrato(
        erro.source,
        erro.endpoint,
        {
          mensagem: erro.message,
          ...(erro.rawPayloadId ? { rawPayloadId: erro.rawPayloadId } : {}),
          issues: (erro.details as { issues?: unknown } | undefined)?.issues,
        },
        ctx.syncRunId,
      );
    }
    throw erro;
  } finally {
    // o resumo de transporte é gravado mesmo se o job falhou — é justamente
    // quando ele falha que saber "a API devolveu 403" vale mais
    await transporte.registrar();
  }
}

async function executarSessoes(
  ctx: ContextoDoJob,
  cityId: string,
  cliente: IngressoClient,
  fontes: FontesDeProducao,
): Promise<void> {
  // 1. cinemas
  const brutos = await cliente.buscarCinemasDaCidade(cityId);
  const permitidos = env.INGRESSO_THEATER_IDS;
  const cinemas = brutos.dados
    .filter((c) => permitidos.length === 0 || permitidos.includes(c.id))
    .map(normalizarCinema);

  const rc = await sincronizarCinemas(cinemas);
  ctx.detalhes.cinemas = rc;

  // 2. sessões e eventos distintos
  const sessoesPorCinema = new Map<string, ReturnType<typeof normalizarSessoes>>();
  const eventos = new Map<string, EventoParaMatching>();

  for (const cinema of cinemas) {
    const r = await cliente.buscarSessoesDoCinema(cityId, cinema.ingressoId);
    sessoesPorCinema.set(
      cinema.ingressoId,
      normalizarSessoes(r.dados, { theaterIngressoId: cinema.ingressoId }),
    );

    for (const dia of r.dados) {
      for (const filme of dia.movies ?? []) {
        if (!eventos.has(filme.id)) eventos.set(filme.id, eventoDoIngresso(filme));
      }
    }
  }

  ctx.contagens.readCount = eventos.size;

  // 3. matching + catálogo
  const titleIdPorEvento = await resolverEventos(eventos, fontes, ctx);

  // 4. sessões no banco
  let gravadas = 0;
  let desativadas = 0;
  for (const [cinemaId, sessoes] of sessoesPorCinema) {
    const r = await sincronizarSessoes(cinemaId, sessoes, titleIdPorEvento);
    gravadas += r.gravadas;
    desativadas += r.desativadas;
    if (r.semTitle > 0) {
      ctx.contagens.errorCount += r.semTitle;
      log.error('sessões sem Title foram puladas', { cinemaId, semTitle: r.semTitle });
    }
  }
  ctx.detalhes.sessoes = { gravadas, desativadas };

  // 5. disponibilidade: quem tem sessão está em cartaz; quem não tem mais, saiu
  const emCartaz = new Set(titleIdPorEvento.values());
  await marcarDisponibilidade(emCartaz, 'em_cartaz');
  ctx.detalhes.saiuDeCartaz = await encerrarDisponibilidadeAusente(emCartaz, 'em_cartaz');

  // 6. tags auto — §9: "recalcular ao fim de cada sync de sessões"
  ctx.detalhes.tags = await recalcularTodasAsTagsAuto();

  // 7. canaries SEMÂNTICO e de MATCHING (§8)
  await checarSemantica(
    {
      eventosLidos: eventos.size,
      preEstreias: 0,
      cinemasVistos: cinemas.map((c) => c.ingressoId),
    },
    ctx.syncRunId,
  );
  await checarTaxaDeMatch(ctx.syncRunId);
  await registrarContratoOk('ingresso', '/sessions', ctx.syncRunId);
}

/**
 * Job de pré-estreias e em breve (§9, 1× ao dia).
 *
 * São eventos que ainda não têm sessão, então não vêm pelo job principal —
 * mas a Carol quer vê-los na home, nas trilhas "Pré-estreias" e "Em breve".
 */
export async function jobProximosLancamentos(ctx: ContextoDoJob): Promise<void> {
  const cityId = env.INGRESSO_CITY_ID;
  if (!cityId) throw new Error('INGRESSO_CITY_ID não está configurada.');

  const cliente = new IngressoClient({ syncRunId: ctx.syncRunId });
  const fontes = new FontesDeProducao({ syncRunId: ctx.syncRunId });

  const listas = [
    { status: 'pre_estreia' as const, dados: (await cliente.buscarPreEstreias(cityId)).dados },
    { status: 'em_breve' as const, dados: (await cliente.buscarEmBreve(cityId)).dados },
  ];

  for (const lista of listas) {
    const eventos = new Map<string, EventoParaMatching>();
    for (const filme of lista.dados) {
      if (!eventos.has(filme.id)) eventos.set(filme.id, eventoDoIngresso(filme));
    }

    ctx.contagens.readCount += eventos.size;

    const titleIdPorEvento = await resolverEventos(eventos, fontes, ctx);
    const titleIds = new Set(titleIdPorEvento.values());

    await marcarDisponibilidade(titleIds, lista.status);
    const encerradas = await encerrarDisponibilidadeAusente(titleIds, lista.status);

    ctx.detalhes[lista.status] = { eventos: eventos.size, encerradas };

    if (lista.status === 'pre_estreia') {
      await checarPreEstreias(eventos.size, ctx.syncRunId);
    }
  }
}

/**
 * Quando a migration `acervo_do_casal` acrescentou as estreias separadas, o
 * status de produção e o idioma da sinopse. Metadata mais velha que isto não
 * tem esses campos, e vence na primeira execução do job depois do deploy.
 */
const COLUNAS_DO_ACERVO_DESDE = new Date('2026-11-18T12:00:00Z');

/**
 * Refresh de metadata (cineon-expansao §5.3): lançamento a cada 7 dias, o resto
 * a cada 90 — ver `precisaAtualizarMetadata`.
 *
 * Só toca em títulos que já têm `tmdb_id` — órfão sem candidato não tem o que
 * atualizar, e quem resolve isso é a fila de revisão.
 *
 * Os mais velhos primeiro, até o teto por execução: depois de uma importação
 * grande, o backlog se esgota em alguns dias em vez de numa rajada só.
 */
export async function jobMetadataTmdb(ctx: ContextoDoJob): Promise<void> {
  const candidatos = await prisma.titleExternalId.findMany({
    where: { source: 'tmdb', title: { status: 'matched' } },
    select: {
      externalId: true,
      titleId: true,
      title: {
        select: {
          releaseDate: true,
          productionStatus: true,
          metadataUpdatedAt: true,
          providersUpdatedAt: true,
        },
      },
    },
  });

  const agora = new Date();
  const vencidos = candidatos
    .filter(
      (c) =>
        precisaAtualizarMetadata(c.title, tmdbConfig.refresh, agora) ||
        // metadata gravada antes das colunas do acervo existirem: sem isto, um
        // filme refrescado na véspera do deploy passaria até 90 dias sem a
        // estreia do Brasil separada e apareceria como "Estreia (mundial)"
        (c.title.metadataUpdatedAt !== null && c.title.metadataUpdatedAt < COLUNAS_DO_ACERVO_DESDE) ||
        // provedores de streaming nunca lidos (passo 7): uma leitura por filme
        // depois do deploy, sem esperar o filme vencer
        c.title.providersUpdatedAt === null,
    )
    .sort(
      (a, b) =>
        (a.title.metadataUpdatedAt?.getTime() ?? 0) - (b.title.metadataUpdatedAt?.getTime() ?? 0),
    );

  const daVez = vencidos.slice(0, tmdbConfig.maxPorExecucao);
  ctx.contagens.readCount = daVez.length;
  ctx.detalhes.candidatos = candidatos.length;
  ctx.detalhes.vencidos = vencidos.length;
  ctx.detalhes.adiados = vencidos.length - daVez.length;
  if (daVez.length === 0) return;

  const tmdb = new TmdbClient({ syncRunId: ctx.syncRunId });

  for (const { externalId } of daVez) {
    try {
      const metadata = await tmdb.obterMetadata(Number(externalId));
      await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata));
      ctx.contagens.matchedCount += 1;
    } catch (erro) {
      ctx.contagens.errorCount += 1;
      log.error('falha ao atualizar metadata', { tmdbId: externalId, erro });
    }
  }
}

/**
 * A ordem em que as notas vencidas gastam a cota do OMDb.
 *
 * 1. o que está em cartaz ou em pré-estreia — é a nota que se olha na frente
 *    do cinema;
 * 2. o que nunca foi consultado — filme recém-adicionado sem nota nenhuma;
 * 3. o resto, da consulta mais velha para a mais nova.
 *
 * Sem isto, um acervo de centenas de filmes recém-importado (§11) comeria a
 * cota do dia e o filme que estreou ontem ficaria sem nota.
 */
export function priorizarNotas<T extends { titleId: string; ratingsUpdatedAt: Date | null }>(
  vencidos: T[],
  emCartaz: ReadonlySet<string>,
): T[] {
  const peso = (v: T) => (emCartaz.has(v.titleId) ? 0 : v.ratingsUpdatedAt === null ? 1 : 2);
  return [...vencidos].sort(
    (a, b) =>
      peso(a) - peso(b) ||
      (a.ratingsUpdatedAt?.getTime() ?? 0) - (b.ratingsUpdatedAt?.getTime() ?? 0),
  );
}

/**
 * Notas do OMDb (§5.3): diária na primeira semana após a estreia, semanal
 * depois, mensal para filme com mais de um ano (cineon-expansao §5.3). É o
 * `Title.releaseDate` que diz em qual regime o filme está.
 *
 * Respeita a cota diária (`OMDB_DAILY_QUOTA`, contada pelas chamadas das
 * últimas 24 h) além do teto por execução. O que não coube fica para amanhã,
 * na ordem de `priorizarNotas`.
 */
export async function jobNotasOmdb(ctx: ContextoDoJob): Promise<void> {
  const candidatos = await prisma.titleExternalId.findMany({
    where: { source: 'imdb', title: { status: 'matched' } },
    select: {
      externalId: true,
      titleId: true,
      title: { select: { releaseDate: true, ratingsUpdatedAt: true, title: true } },
    },
  });

  const vencidos = candidatos
    .filter((c) => precisaAtualizarNotas(c.title.releaseDate, c.title.ratingsUpdatedAt, omdbConfig))
    .map((c) => ({ ...c, ratingsUpdatedAt: c.title.ratingsUpdatedAt }));

  const emCartaz = new Set(
    (
      await prisma.availability.findMany({
        where: {
          titleId: { in: vencidos.map((v) => v.titleId) },
          source: 'cinema',
          status: { in: ['em_cartaz', 'pre_estreia'] },
          endedAt: null,
        },
        select: { titleId: true },
      })
    ).map((a) => a.titleId),
  );

  const cota = await cotaDoOmdb(omdbConfig.dailyQuota);
  const cabem = Math.min(cota.restante, MAX_NOTAS_POR_EXECUCAO);
  const daVez = priorizarNotas(vencidos, emCartaz).slice(0, cabem);

  ctx.contagens.readCount = daVez.length;
  ctx.detalhes.candidatos = candidatos.length;
  ctx.detalhes.vencidos = vencidos.length;
  ctx.detalhes.adiados = vencidos.length - daVez.length;
  ctx.detalhes.cota = { limite: omdbConfig.dailyQuota, usadasEm24h: cota.usadas };

  if (daVez.length < vencidos.length) {
    log.warn('notas vencidas ficaram para a próxima execução', {
      vencidos: vencidos.length,
      daVez: daVez.length,
      cotaRestante: cota.restante,
      teto: MAX_NOTAS_POR_EXECUCAO,
    });
  }

  const omdb = new OmdbClient({ syncRunId: ctx.syncRunId });
  let semNota = 0;

  for (const alvo of daVez) {
    try {
      const r = await omdb.buscarNotas(alvo.externalId);

      if (r.tipo === 'nao_encontrado') {
        // o OMDb não conhece este imdb_id — acontece com lançamento recente.
        // Marca a data para não reconsultar todo dia, e segue: ausência de
        // nota nunca quebra o fluxo (§5.3).
        await atualizarNotas(alvo.titleId, { imdbRating: null, rtRating: null });
        semNota += 1;
        continue;
      }

      await atualizarNotas(alvo.titleId, {
        imdbRating: r.notas.imdbRating,
        rtRating: r.notas.rtRating,
      });
      ctx.contagens.matchedCount += 1;
    } catch (erro) {
      ctx.contagens.errorCount += 1;
      log.error('falha ao buscar notas', { imdbId: alvo.externalId, erro });
    }
  }

  ctx.detalhes.semNota = semNota;
}

/** Recalcula as facetas automáticas sem passar pelo sync inteiro. */
export async function jobTags(ctx: ContextoDoJob): Promise<void> {
  const r = await recalcularTodasAsTagsAuto();
  ctx.contagens.readCount = r.titulos;
  ctx.detalhes.tags = r;
}
