import { Prisma } from '@prisma/client';
import type { Pessoa } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { env } from '../../config/env';
import { prisma } from '../../shared/prisma';
// arquivos de dentro dos módulos, não os barris: os barris exportam rotas, e
// rota importando o orquestrador importando rota fecharia um ciclo
import { detalheDoTitulo } from '../catalog/catalog.queries';
import { upsertPorTmdbId } from '../catalog/catalog.service';
import { normalizarTitulo } from '../matching/matching.normalizer';
import { TmdbClient } from '../tmdb';
import { definirNota, notasDoTitulo, removerNotasDoTitulo, restaurarNotasDoTitulo } from '../ratings';
import type { NotaDaPessoa } from '../ratings';
import {
  comentariosDoTitulo,
  removerComentariosDoTitulo,
  restaurarComentariosDoTitulo,
} from '../comments/comments.service';
import {
  participouDe,
  registrarVisualizacao,
  removerVisualizacoesDoTitulo,
  restaurarVisualizacoesDoTitulo,
  visualizacoesDoTitulo,
} from '../watches/watches.service';
import type { DadosDaVisualizacao, VisualizacaoDoTitulo } from '../watches/watches.types';
import {
  quemQuerOTitulo,
  removerDaListaDoTitulo,
  restaurarListaDoTitulo,
  tirarDaListaDe,
} from '../watchlist/watchlist.service';
import type { DetalheDoAcervo, GrupoDeProvedores, SituacaoDaPessoa } from './library.types';
import { tmdbConfig } from '../../config/metadata';

/**
 * O orquestrador do acervo do casal (cineon-expansao §9).
 *
 * Depende de `catalog`, `tmdb`, `watches`, `watchlist` e `ratings`; nenhum
 * deles depende dele, nem uns dos outros. Por isso as regras que CRUZAM esses
 * módulos moram aqui e só aqui:
 *
 * - registrar uma visualização tira o filme da lista de quem estava (§3.3);
 * - só dá nota quem participou de alguma visualização (§3.2);
 * - "remover do catálogo" mexe nas três tabelas de uma vez (§4.4).
 */

const PESSOAS: Pessoa[] = ['CAT', 'BEAR'];
const ELENCO_NO_DETALHE = 10;

// ── adicionar ───────────────────────────────────────────────

/**
 * Cria o `Title` a partir do `tmdb_id`, ou devolve o que já existe.
 *
 * **Nunca duplica** (§4.1, critério de aceite): um filme que entrou pelo
 * ingresso e depois pelo "+" é o mesmo registro. Quando já existe, nem chama o
 * TMDB — quem atualiza metadata é o job de refresh.
 */
export async function adicionarPorTmdbId(
  tmdbId: number,
  tmdb: TmdbClient = new TmdbClient(),
): Promise<{ titleId: string; criado: boolean }> {
  const existente = await tituloDoTmdb(tmdbId);
  if (existente) return { titleId: existente, criado: false };

  const metadata = await tmdb.obterMetadata(tmdbId);

  try {
    const titleId = await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata));
    return { titleId, criado: true };
  } catch (erro) {
    // dois "+" no mesmo filme ao mesmo tempo: o índice único segura o
    // segundo, e o segundo devolve o que o primeiro criou
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      const criadoPeloOutro = await tituloDoTmdb(tmdbId);
      if (criadoPeloOutro) return { titleId: criadoPeloOutro, criado: false };
    }
    throw erro;
  }
}

async function tituloDoTmdb(tmdbId: number): Promise<string | null> {
  const id = await prisma.titleExternalId.findUnique({
    where: { source_externalId: { source: 'tmdb', externalId: String(tmdbId) } },
    select: { titleId: true },
  });
  return id?.titleId ?? null;
}

/**
 * "Não encontrei o filme" (cineon-expansao §3.5): o filme que ainda não está
 * no TMDB — comum com anúncio muito recente — entra como `Title` órfão, só com
 * o título (e o ano, quando se sabe), para poder ir para a lista ou ganhar uma
 * visualização. Ele aparece com "metadata pendente" e entra na fila Revisar,
 * onde a Carol o liga ao TMDB quando o filme existir lá; o `mergeTitles` leva
 * junto tudo o que já tiver sido registrado.
 *
 * Não é o caminho normal do "+" (§4.1): a tela só oferece isto num link
 * discreto, depois da busca.
 */
export async function adicionarSemTmdb(titulo: string, ano: number | null): Promise<{ titleId: string }> {
  const limpo = titulo.trim().replace(/\s+/g, ' ');
  if (limpo.length === 0) throw new ValidationError('Diga o título do filme.');

  return prisma.$transaction(async (tx) => {
    const { id } = await tx.title.create({
      data: {
        status: 'orphan',
        title: limpo,
        normalizedTitle: normalizarTitulo(limpo).normalizado,
        year: ano,
      },
      select: { id: true },
    });

    await tx.reviewItem.create({
      data: {
        origin: 'manual',
        ingressoEventId: null,
        ingressoTitle: limpo,
        ingressoYear: ano,
        subjectTitleId: id,
        reason: 'no_candidate',
        note: 'Adicionado à mão pelo "+": não estava no TMDB. Quando aparecer lá, escolha o filme certo aqui.',
      },
    });

    return { titleId: id };
  });
}

// ── detalhe (§7) ────────────────────────────────────────────

export async function detalheDoAcervo(titleId: string, eu: Pessoa): Promise<DetalheDoAcervo> {
  const [base, extra, visualizacoes, lista, notas, comentarios] = await Promise.all([
    detalheDoTitulo(titleId),
    prisma.title.findUnique({
      where: { id: titleId },
      select: {
        overviewLanguage: true,
        releaseDate: true,
        releaseDateBr: true,
        releaseDateOriginal: true,
        productionStatus: true,
        justwatchUrl: true,
      },
    }),
    visualizacoesDoTitulo(titleId),
    quemQuerOTitulo(titleId),
    notasDoTitulo(titleId),
    comentariosDoTitulo(titleId),
  ]);
  const provedores = await provedoresDoTitulo(titleId);

  // `detalheDoTitulo` já lança NotFound; isto só satisfaz o tipo
  if (!extra) throw new NotFoundError(`Título "${titleId}" não existe.`);

  const dataBr = extra.releaseDateBr;
  // sem as colunas novas preenchidas (título antes do refresh), o `releaseDate`
  // antigo ainda é melhor que nada — e não dá para saber se é do Brasil
  const data = dataBr ?? extra.releaseDateOriginal ?? extra.releaseDate;

  const pessoas: SituacaoDaPessoa[] = PESSOAS.map((pessoa) => {
    const naLista = lista.find((l) => l.pessoa === pessoa);
    const assistiu = visualizacoes.some((v) => v.participantes.includes(pessoa));
    return {
      pessoa,
      assistiu,
      querAssistir: Boolean(naLista),
      interesse: naLista?.interesse ?? null,
      nota: notas.find((n) => n.pessoa === pessoa)?.nota ?? null,
      podeDarNota: assistiu,
      comentario: comentarios.find((c) => c.pessoa === pessoa)?.texto ?? null,
    };
  });

  return {
    ...base,
    elenco: base.elenco.slice(0, ELENCO_NO_DETALHE),
    sinopseIdioma: base.sinopse ? extra.overviewLanguage : null,
    // "Estreia (mundial)" quando não há data do Brasil (§5.1)
    estreia: data ? { data: data.toISOString().slice(0, 10), mundial: !dataBr } : null,
    statusProducao: extra.productionStatus,
    justwatchUrl: extra.justwatchUrl,
    provedores,
    // Sem link salvo, a busca do JustWatch pelo título em português: a busca do
    // site é textual, e acrescentar o ano atrapalha mais do que ajuda.
    ondeAssistirUrl: extra.justwatchUrl ?? `${env.JUSTWATCH_SEARCH_URL}${encodeURIComponent(base.titulo)}`,
    emCartaz: base.disponibilidade.some((d) => d.status === 'em_cartaz' || d.status === 'pre_estreia'),
    eu,
    pessoas,
    visualizacoes,
  };
}

// ── onde assistir (§6) ──────────────────────────────────────

const ROTULO_DO_PROVEDOR: Record<GrupoDeProvedores['tipo'], string> = {
  flatrate: 'Assinatura',
  free: 'Grátis',
  ads: 'Com anúncios',
  rent: 'Aluguel',
  buy: 'Compra',
};

/**
 * Os serviços em que o filme está no país configurado, agrupados por tipo,
 * na ordem em que se responde "onde assistir?": primeiro o que já se paga
 * (assinatura), depois o que é de graça, e só então alugar e comprar.
 */
export async function provedoresDoTitulo(titleId: string): Promise<GrupoDeProvedores[]> {
  const linhas = await prisma.titleProvider.findMany({
    where: { titleId, region: tmdbConfig.region },
    orderBy: [{ displayPriority: 'asc' }, { providerId: 'asc' }],
    select: { type: true, provider: { select: { id: true, name: true, logoUrl: true } } },
  });

  return (Object.keys(ROTULO_DO_PROVEDOR) as Array<GrupoDeProvedores['tipo']>)
    .map((tipo) => ({
      tipo,
      rotulo: ROTULO_DO_PROVEDOR[tipo],
      itens: linhas
        .filter((l) => l.type === tipo)
        .map((l) => ({ id: l.provider.id, nome: l.provider.name, logoUrl: l.provider.logoUrl })),
    }))
    .filter((g) => g.itens.length > 0);
}

/**
 * `GET /titles/:id/where-to-watch` (§9): para onde o botão leva e os
 * provedores, sem o detalhe inteiro.
 */
export async function ondeAssistir(
  titleId: string,
): Promise<{ url: string; justwatchUrl: string | null; provedores: GrupoDeProvedores[] }> {
  const titulo = await prisma.title.findUnique({
    where: { id: titleId },
    select: { title: true, justwatchUrl: true },
  });
  if (!titulo) throw new NotFoundError(`Título "${titleId}" não existe.`);

  return {
    url: titulo.justwatchUrl ?? `${env.JUSTWATCH_SEARCH_URL}${encodeURIComponent(titulo.title)}`,
    justwatchUrl: titulo.justwatchUrl,
    provedores: await provedoresDoTitulo(titleId),
  };
}

// ── editar ──────────────────────────────────────────────────

/**
 * O link do JustWatch, colado à mão no "Editar" (§6). Só aceita página do
 * JustWatch: um link qualquer aqui viraria o botão "Onde assistir" levando a
 * outro lugar.
 */
export async function definirJustwatchUrl(titleId: string, url: string | null): Promise<string | null> {
  let valor: string | null = null;

  if (url && url.trim()) {
    let endereco: URL;
    try {
      endereco = new URL(url.trim());
    } catch {
      throw new ValidationError('Isso não é um endereço.');
    }
    const host = endereco.hostname.toLowerCase();
    if (endereco.protocol !== 'https:' || !(host === 'justwatch.com' || host.endsWith('.justwatch.com'))) {
      throw new ValidationError('O link precisa ser uma página do JustWatch (https://…justwatch.com/…).');
    }
    valor = endereco.toString();
  }

  const { count } = await prisma.title.updateMany({ where: { id: titleId }, data: { justwatchUrl: valor } });
  if (count === 0) throw new NotFoundError(`Título "${titleId}" não existe.`);
  return valor;
}

// ── remover do catálogo (§4.4) ──────────────────────────────

export interface ResultadoDaRemocao {
  /** o carimbo: é ele que o "desfazer" devolve */
  removidoEm: Date;
  visualizacoes: number;
  lista: number;
  notas: number;
  comentarios: number;
}

/**
 * Tira o filme do acervo: visualizações, lista, notas e comentários, com UM
 * carimbo só.
 *
 * O `Title` não é apagado — ele pode estar em cartaz, e as sessões e o
 * catálogo do cinema não têm nada a ver com o acervo.
 */
export async function removerDoCatalogo(titleId: string): Promise<ResultadoDaRemocao> {
  const removidoEm = new Date();

  const resultado = await prisma.$transaction(async (tx) => ({
    removidoEm,
    visualizacoes: await removerVisualizacoesDoTitulo(titleId, removidoEm, tx),
    lista: await removerDaListaDoTitulo(titleId, removidoEm, tx),
    notas: await removerNotasDoTitulo(titleId, removidoEm, tx),
    comentarios: await removerComentariosDoTitulo(titleId, removidoEm, tx),
  }));

  if (resultado.visualizacoes + resultado.lista + resultado.notas + resultado.comentarios === 0) {
    throw new NotFoundError('Este filme não está no acervo de vocês.');
  }
  return resultado;
}

/**
 * O desfazer: volta exatamente o que aquele carimbo removeu. Uma visualização
 * apagada antes, de propósito, continua apagada.
 */
export async function restaurarNoCatalogo(
  titleId: string,
  removidoEm: Date,
): Promise<Omit<ResultadoDaRemocao, 'removidoEm'>> {
  return prisma.$transaction(async (tx) => ({
    visualizacoes: await restaurarVisualizacoesDoTitulo(titleId, removidoEm, tx),
    lista: await restaurarListaDoTitulo(titleId, removidoEm, tx),
    notas: await restaurarNotasDoTitulo(titleId, removidoEm, tx),
    comentarios: await restaurarComentariosDoTitulo(titleId, removidoEm, tx),
  }));
}

// ── assistir e dar nota ─────────────────────────────────────

/**
 * Registra uma visualização e tira o filme da lista de quem estava (§3.3),
 * na mesma transação: uma visualização gravada com a lista intacta seria o
 * filme "assistido" e "quero assistir" ao mesmo tempo.
 *
 * Devolve as linhas que saíram da lista, para a tela oferecer o desfazer
 * (`POST /watchlist/restaurar`).
 */
export async function registrarQueAssistimos(
  titleId: string,
  dados: DadosDaVisualizacao,
): Promise<{
  visualizacao: VisualizacaoDoTitulo;
  removidosDaLista: Array<{ id: string; pessoa: Pessoa }>;
}> {
  return prisma.$transaction(async (tx) => {
    const visualizacao = await registrarVisualizacao(titleId, dados, tx);
    const removidosDaLista = await tirarDaListaDe(
      titleId,
      visualizacao.participantes,
      new Date(),
      tx,
    );
    return { visualizacao, removidosDaLista };
  });
}

/** Só dá nota quem participou de alguma visualização (§3.2). */
export async function darNota(titleId: string, pessoa: Pessoa, nota: number): Promise<NotaDaPessoa> {
  const existe = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true } });
  if (!existe) throw new NotFoundError(`Título "${titleId}" não existe.`);

  if (!(await participouDe(titleId, pessoa))) {
    throw new ConflictError('Só dá nota quem assistiu: registre a visualização primeiro.');
  }
  return definirNota(titleId, pessoa, nota);
}
