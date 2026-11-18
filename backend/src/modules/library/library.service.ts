import { Prisma } from '@prisma/client';
import type { Pessoa } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
// arquivos de dentro dos módulos, não os barris: os barris exportam rotas, e
// rota importando o orquestrador importando rota fecharia um ciclo
import { detalheDoTitulo } from '../catalog/catalog.queries';
import { upsertPorTmdbId } from '../catalog/catalog.service';
import { TmdbClient } from '../tmdb';
import { definirNota, notasDoTitulo, removerNotasDoTitulo, restaurarNotasDoTitulo } from '../ratings';
import type { NotaDaPessoa } from '../ratings';
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
import type { DetalheDoAcervo, SituacaoDaPessoa } from './library.types';

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

// ── detalhe (§7) ────────────────────────────────────────────

export async function detalheDoAcervo(titleId: string, eu: Pessoa): Promise<DetalheDoAcervo> {
  const [base, extra, visualizacoes, lista, notas] = await Promise.all([
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
  ]);

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
    emCartaz: base.disponibilidade.some((d) => d.status === 'em_cartaz' || d.status === 'pre_estreia'),
    eu,
    pessoas,
    visualizacoes,
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
}

/**
 * Tira o filme do acervo: visualizações, lista e notas, com UM carimbo só.
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
  }));

  if (resultado.visualizacoes + resultado.lista + resultado.notas === 0) {
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
