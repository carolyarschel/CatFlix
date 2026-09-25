import { Prisma } from '@prisma/client';
import type { ReviewReason, ReviewResolution } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { mergeTitles, upsertPorTmdbId } from '../catalog';
import { recalcularTagsDoTitulo } from '../tags';
import { TmdbClient, normalizarMetadata } from '../tmdb';

const log = logger.child({ module: 'review' });

/**
 * Fila de revisão humana (§10).
 *
 * A regra que atravessa o módulo: **resolver uma pendência tem de sobreviver
 * ao próximo sync.** Toda resolução termina reapontando o `TitleExternalId` do
 * evento do ingresso — que é o cache do estágio 0 do matching. Sem isso, a
 * Carol confirmaria um filme às onze da noite e às seis da manhã o sync
 * restauraria a decisão velha.
 */

export interface ItemDaFila {
  id: string;
  eventoTitulo: string;
  eventoMeta: string;
  candidatoTitulo: string | null;
  candidatoMeta: string | null;
  temCandidato: boolean;
  candidatoTmdbId: number | null;
  motivo: ReviewReason;
  score: number | null;
  criadoEm: Date;
  /** o Title órfão que representa este evento hoje */
  subjectTitleId: string | null;
  posterUrl: string | null;
  /**
   * Por que o matcher parou aqui, em português, como ele mesmo escreveu no
   * `MatchDecision` ("Gêneros do TMDB confirmaram evento, não filme (Music,
   * Documentary)").
   *
   * Acréscimo de 23/09/2026, ao montar a tela: sem isto o card mostrava só um
   * número e um rótulo de enum, e a pessoa tinha de adivinhar o que o
   * algoritmo viu. Com 71 pendências reais na fila, adivinhar 71 vezes não é
   * revisão, é sorteio.
   */
  explicacao: string | null;
}

export interface FilaDeRevisao {
  itens: ItemDaFila[];
  total: number;
  /** contagem por motivo — alimenta as pills "Tudo (4)", "Confiança baixa (2)" */
  porMotivo: Array<{ motivo: ReviewReason; quantidade: number }>;
}

function metaDoEvento(item: {
  ingressoYear: number | null;
  ingressoPayload: unknown;
}): string {
  const p = (item.ingressoPayload ?? {}) as {
    runtimeMinutes?: number | null;
    distributor?: string | null;
  };

  return [
    item.ingressoYear ? String(item.ingressoYear) : null,
    p.runtimeMinutes ? `${p.runtimeMinutes} min` : null,
    p.distributor,
  ]
    .filter(Boolean)
    .join(' · ');
}

export async function listarFila(
  opcoes: { motivo?: ReviewReason; limite?: number } = {},
): Promise<FilaDeRevisao> {
  const [itens, total, agrupado] = await Promise.all([
    prisma.reviewItem.findMany({
      where: { status: 'open', ...(opcoes.motivo ? { reason: opcoes.motivo } : {}) },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: opcoes.limite ?? 100,
      select: {
        id: true,
        ingressoEventId: true,
        ingressoTitle: true,
        ingressoYear: true,
        ingressoPayload: true,
        candidateLabel: true,
        candidateTmdbId: true,
        candidatePayload: true,
        score: true,
        reason: true,
        createdAt: true,
        subjectTitleId: true,
        subjectTitle: { select: { posterUrl: true } },
        candidateTitle: { select: { title: true, year: true, posterUrl: true } },
      },
    }),
    prisma.reviewItem.count({ where: { status: 'open' } }),
    prisma.reviewItem.groupBy({ by: ['reason'], where: { status: 'open' }, _count: true }),
  ]);

  // A explicação vem da decisão MAIS RECENTE de cada evento: o sync pode ter
  // decidido o mesmo evento várias vezes, e a que vale é a última.
  const explicacoes = await decisoesRecentes(itens.map((i) => i.ingressoEventId));

  return {
    itens: itens.map((i) => {
      const rotulo = i.candidateLabel ?? i.candidateTitle?.title ?? null;
      const ano = i.candidateTitle?.year;

      return {
        id: i.id,
        eventoTitulo: i.ingressoTitle,
        eventoMeta: metaDoEvento(i),
        candidatoTitulo: rotulo,
        candidatoMeta: [ano ? String(ano) : null, i.candidateTmdbId ? `TMDB ${i.candidateTmdbId}` : null]
          .filter(Boolean)
          .join(' · ') || null,
        temCandidato: rotulo !== null || i.candidateTmdbId !== null,
        candidatoTmdbId: i.candidateTmdbId,
        motivo: i.reason,
        score: i.score,
        criadoEm: i.createdAt,
        subjectTitleId: i.subjectTitleId,
        posterUrl: i.candidateTitle?.posterUrl ?? i.subjectTitle?.posterUrl ?? null,
        explicacao: explicacoes.get(i.ingressoEventId) ?? null,
      };
    }),
    total,
    porMotivo: agrupado.map((g) => ({ motivo: g.reason, quantidade: g._count })),
  };
}

/**
 * Só o número, para a badge da navegação (§2).
 *
 * Endpoint separado de propósito: a badge é consultada em toda navegação, e
 * trazer a fila inteira para mostrar um número seria desperdício.
 */
export async function contarFila(): Promise<number> {
  return prisma.reviewItem.count({ where: { status: 'open' } });
}

// ── resoluções ───────────────────────────────────────────────

export interface ResultadoDaResolucao {
  reviewItemId: string;
  resolution: ReviewResolution;
  titleId: string | null;
  mesclou: boolean;
}

async function carregarAberto(id: string) {
  const item = await prisma.reviewItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError(`Pendência não encontrada: ${id}`);
  if (item.status === 'resolved') {
    throw new ConflictError('Esta pendência já foi resolvida.', {
      details: { resolution: item.resolution, resolvedAt: item.resolvedAt },
    });
  }
  return item;
}

async function fechar(
  id: string,
  resolution: ReviewResolution,
  titleId: string | null,
  resolvedById?: string,
): Promise<void> {
  await prisma.reviewItem.update({
    where: { id },
    data: {
      status: 'resolved',
      resolution,
      resolvedTitleId: titleId,
      resolvedById: resolvedById ?? null,
      resolvedAt: new Date(),
    },
  });
}

/**
 * Materializa um filme do TMDB e faz o evento do ingresso apontar para ele.
 *
 * É o miolo de "confirmar" e de "trocar": as duas ações só diferem em QUAL
 * tmdbId usar.
 */
async function adotarCandidato(
  item: { id: string; ingressoEventId: string; subjectTitleId: string | null },
  tmdbId: number,
  resolvedById?: string,
): Promise<{ titleId: string; mesclou: boolean }> {
  const tmdb = new TmdbClient();
  const detalhe = await tmdb.buscarFilme(tmdbId);
  const metadata = normalizarMetadata(detalhe.dados);

  const titleId = await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata));

  let mesclou = false;

  // O órfão que representava este evento precisa CEDER o lugar: sessões, tags
  // e estado do usuário migram para o Title de verdade (§7.3). O TitleAlias
  // gravado pelo merge é o que impede o sync de separar os dois amanhã.
  if (item.subjectTitleId && item.subjectTitleId !== titleId) {
    await mergeTitles(item.subjectTitleId, titleId, {
      reason: `revisão: adotado o TMDB ${tmdbId}`,
      ...(resolvedById ? { mergedById: resolvedById } : {}),
    });
    mesclou = true;
  }

  // garante o cache do estágio 0 apontando para o lugar certo
  await prisma.titleExternalId.upsert({
    where: { source_externalId: { source: 'ingresso', externalId: item.ingressoEventId } },
    update: { titleId, method: 'manual', confidence: 1, verifiedAt: new Date(), verifiedById: resolvedById ?? null },
    create: {
      titleId,
      source: 'ingresso',
      externalId: item.ingressoEventId,
      method: 'manual',
      confidence: 1,
      verifiedAt: new Date(),
      verifiedById: resolvedById ?? null,
    },
  });

  await recalcularTagsDoTitulo(titleId);

  return { titleId, mesclou };
}

/** `POST /review/:id/confirm` — aceita o candidato sugerido. */
export async function confirmar(id: string, resolvedById?: string): Promise<ResultadoDaResolucao> {
  const item = await carregarAberto(id);

  if (!item.candidateTmdbId) {
    throw new ValidationError(
      'Esta pendência não tem candidato do TMDB para confirmar. Use "trocar" informando o tmdbId.',
    );
  }

  const r = await adotarCandidato(item, item.candidateTmdbId, resolvedById);
  await fechar(id, 'confirmed', r.titleId, resolvedById);

  log.info('pendência confirmada', { id, titleId: r.titleId, tmdbId: item.candidateTmdbId });
  return { reviewItemId: id, resolution: 'confirmed', titleId: r.titleId, mesclou: r.mesclou };
}

/** `POST /review/:id/replace` — a Carol escolheu outro filme no TMDB. */
export async function substituir(
  id: string,
  tmdbId: number,
  resolvedById?: string,
): Promise<ResultadoDaResolucao> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new ValidationError('tmdbId inválido.');
  }

  const item = await carregarAberto(id);
  const r = await adotarCandidato(item, tmdbId, resolvedById);
  await fechar(id, 'replaced', r.titleId, resolvedById);

  log.info('pendência resolvida com outro filme', { id, titleId: r.titleId, tmdbId });
  return { reviewItemId: id, resolution: 'replaced', titleId: r.titleId, mesclou: r.mesclou };
}

/**
 * `POST /review/:id/not-a-film` — é show, ópera, transmissão.
 *
 * O evento **não some**: vira `Title` com status `not_a_film`, que o app
 * mostra como evento sem metadata (§7.2). O que ele não faz é poluir as
 * trilhas de filme.
 */
export async function marcarComoNaoFilme(
  id: string,
  resolvedById?: string,
): Promise<ResultadoDaResolucao> {
  const item = await carregarAberto(id);

  if (item.subjectTitleId) {
    await prisma.title.update({
      where: { id: item.subjectTitleId },
      data: { status: 'not_a_film' },
    });
  }

  await fechar(id, 'marked_not_a_film', item.subjectTitleId, resolvedById);

  log.info('pendência marcada como não-filme', { id, titleId: item.subjectTitleId });
  return {
    reviewItemId: id,
    resolution: 'marked_not_a_film',
    titleId: item.subjectTitleId,
    mesclou: false,
  };
}

/** `POST /review/:id/merge` — este evento é o mesmo filme de outro Title. */
export async function mesclar(
  id: string,
  toTitleId: string,
  resolvedById?: string,
): Promise<ResultadoDaResolucao> {
  const item = await carregarAberto(id);

  if (!item.subjectTitleId) {
    throw new ValidationError('Esta pendência não tem um Title de origem para unir.');
  }

  const destino = await prisma.title.findUnique({ where: { id: toTitleId }, select: { id: true } });
  if (!destino) throw new NotFoundError(`Title de destino não encontrado: ${toTitleId}`);

  await mergeTitles(item.subjectTitleId, toTitleId, {
    reason: 'revisão: mesmo filme',
    ...(resolvedById ? { mergedById: resolvedById } : {}),
  });

  await prisma.titleExternalId.upsert({
    where: { source_externalId: { source: 'ingresso', externalId: item.ingressoEventId } },
    update: { titleId: toTitleId, method: 'manual', confidence: 1, verifiedAt: new Date() },
    create: {
      titleId: toTitleId,
      source: 'ingresso',
      externalId: item.ingressoEventId,
      method: 'manual',
      confidence: 1,
      verifiedAt: new Date(),
    },
  });

  await recalcularTagsDoTitulo(toTitleId);
  await fechar(id, 'merged', toTitleId, resolvedById);

  log.info('pendência resolvida por merge', { id, de: item.subjectTitleId, para: toTitleId });
  return { reviewItemId: id, resolution: 'merged', titleId: toTitleId, mesclou: true };
}

/**
 * `POST /review/:id/dismiss` — "é filme mesmo, mas o TMDB não tem".
 *
 * Não está na lista do §10, mas o enum `ReviewResolution` prevê, e o caso é
 * real: filme nacional pequeno que não existe no TMDB. Sem isto, a pendência
 * ficaria aberta para sempre e a badge nunca zeraria.
 */
export async function dispensar(id: string, resolvedById?: string): Promise<ResultadoDaResolucao> {
  const item = await carregarAberto(id);
  await fechar(id, 'dismissed', item.subjectTitleId, resolvedById);

  log.info('pendência dispensada; título segue órfão de propósito', { id });
  return { reviewItemId: id, resolution: 'dismissed', titleId: item.subjectTitleId, mesclou: false };
}

/** Busca no TMDB para a tela de "trocar". */
export async function buscarCandidatos(
  query: string,
  ano?: number | null,
): Promise<Array<{ tmdbId: number; titulo: string; tituloOriginal: string | null; ano: number | null; posterUrl: string | null }>> {
  if (!query.trim()) throw new ValidationError('Informe um termo de busca.');

  const tmdb = new TmdbClient();
  const busca = await tmdb.buscarFilmes(query, { ano: ano ?? null });

  return busca.dados.results.slice(0, 10).map((r) => ({
    tmdbId: r.id,
    titulo: r.title,
    tituloOriginal: r.original_title ?? null,
    ano: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
  }));
}

/**
 * A explicação da decisão que de fato mandou o evento para a fila.
 *
 * ⚠️ **Ignora o estágio `cache`.** Ele é o mais recente de quase todo evento
 * depois do segundo sync, e o que ele diz é "reaproveitada sem consultar o
 * TMDB" — verdadeiro e inútil para quem precisa decidir. A decisão que explica
 * é a última que realmente pensou: triagem, match forte, fuzzy ou limiar.
 *
 * `DISTINCT ON` do Postgres em vez de N consultas: a fila traz até 100 itens, e
 * cem viagens ao banco para pegar cem strings seria a definição de N+1.
 */
async function decisoesRecentes(eventIds: string[]): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();

  const linhas = await prisma.$queryRaw<Array<{ eventId: string; reason: string | null }>>`
    SELECT DISTINCT ON (ingresso_event_id)
      ingresso_event_id AS "eventId",
      reason
    FROM match_decisions
    WHERE ingresso_event_id IN (${Prisma.join(eventIds)})
      AND stage <> 'cache'
      AND reason IS NOT NULL
    ORDER BY ingresso_event_id, decided_at DESC
  `;

  return new Map(linhas.filter((l) => l.reason).map((l) => [l.eventId, l.reason as string]));
}
