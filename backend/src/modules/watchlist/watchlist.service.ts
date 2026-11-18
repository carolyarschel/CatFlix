import type { Pessoa, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
// arquivos do serviço, não o barril: o barril exporta rotas
import { diaNoFuso } from '../cinemas/cinemas.queries';
import { fusoDaCidade } from '../cinemas/cinemas.service';
// só formatação, sem consulta: não cria dependência do catálogo
import { formatarNotaImdb, formatarNotaRt } from '../catalog/catalog.format';
import type { EscopoDaLista, GrupoDaLista, ItemDaLista, QuemQuer } from './watchlist.types';

/**
 * Lista "quero assistir" (cineon-expansao §3.2): uma linha por pessoa e filme.
 *
 * "Os dois querem" não é gravado — é existirem as duas linhas ativas. Tirar e
 * pôr de novo reativa a mesma linha (`@@unique([titleId, pessoa])`), em vez de
 * empilhar linhas removidas.
 */

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

function validarInteresse(interesse: number | null | undefined): void {
  if (interesse === null || interesse === undefined) return;
  if (!Number.isInteger(interesse) || interesse < 1 || interesse > 5) {
    throw new ValidationError('O interesse vai de 1 a 5 estrelas.');
  }
}

/**
 * Põe na lista (ou atualiza o interesse de quem já está).
 *
 * `interesse` ausente não mexe no que havia; `null` apaga as estrelas.
 * Voltar à lista conta como entrada nova: `addedAt` é renovado.
 */
export async function adicionarALista(
  titleId: string,
  pessoa: Pessoa,
  interesse?: number | null,
): Promise<QuemQuer> {
  validarInteresse(interesse);

  const titulo = await prisma.title.findUnique({ where: { id: titleId }, select: { status: true } });
  if (!titulo) throw new NotFoundError(`Título "${titleId}" não existe.`);
  if (titulo.status === 'merged') {
    throw new ValidationError('Este título foi unido a outro; use o filme que ficou.');
  }

  const atual = await prisma.watchlistEntry.findUnique({
    where: { titleId_pessoa: { titleId, pessoa } },
    select: { removedAt: true },
  });

  const linha = await prisma.watchlistEntry.upsert({
    where: { titleId_pessoa: { titleId, pessoa } },
    create: { titleId, pessoa, interest: interesse ?? null },
    update: {
      removedAt: null,
      ...(interesse !== undefined ? { interest: interesse } : {}),
      ...(atual?.removedAt ? { addedAt: new Date() } : {}),
    },
    select: { pessoa: true, interest: true, addedAt: true },
  });

  return { pessoa: linha.pessoa, interesse: linha.interest, adicionadoEm: linha.addedAt };
}

export async function tirarDaLista(titleId: string, pessoa: Pessoa): Promise<{ removidoEm: Date }> {
  const removidoEm = new Date();
  const { count } = await prisma.watchlistEntry.updateMany({
    where: { titleId, pessoa, removedAt: null },
    data: { removedAt: removidoEm },
  });
  if (count === 0) throw new NotFoundError('Este filme não está na sua lista.');
  return { removidoEm };
}

/**
 * Tira o filme da lista destas pessoas e diz quais linhas saíram — é o
 * "Removido da sua lista" com desfazer do §3.3, depois de uma visualização.
 */
export async function tirarDaListaDe(
  titleId: string,
  pessoas: Pessoa[],
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<Array<{ id: string; pessoa: Pessoa }>> {
  const ativas = await db.watchlistEntry.findMany({
    where: { titleId, pessoa: { in: pessoas }, removedAt: null },
    select: { id: true, pessoa: true },
  });
  if (ativas.length === 0) return [];

  await db.watchlistEntry.updateMany({
    where: { id: { in: ativas.map((a) => a.id) } },
    data: { removedAt: removidoEm },
  });
  return ativas;
}

/** O desfazer: volta exatamente estas linhas, com o interesse que tinham. */
export async function restaurarNaLista(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return (
    await prisma.watchlistEntry.updateMany({
      where: { id: { in: ids }, removedAt: { not: null } },
      data: { removedAt: null },
    })
  ).count;
}

/** "Remover do catálogo" (§4.4): todas as linhas do título, com um carimbo só. */
export async function removerDaListaDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.watchlistEntry.updateMany({
      where: { titleId, removedAt: null },
      data: { removedAt: removidoEm },
    })
  ).count;
}

/** Desfaz exatamente o que aquele carimbo removeu. */
export async function restaurarListaDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.watchlistEntry.updateMany({
      where: { titleId, removedAt: removidoEm },
      data: { removedAt: null },
    })
  ).count;
}

export async function quemQuerOTitulo(titleId: string): Promise<QuemQuer[]> {
  const linhas = await prisma.watchlistEntry.findMany({
    where: { titleId, removedAt: null },
    orderBy: { pessoa: 'asc' },
    select: { pessoa: true, interest: true, addedAt: true },
  });
  return linhas.map((l) => ({ pessoa: l.pessoa, interesse: l.interest, adicionadoEm: l.addedAt }));
}

// ── a aba "Quero assistir" ───────────────────────────────────

const ORDEM_DAS_PESSOAS: Pessoa[] = ['CAT', 'BEAR'];

const ORDEM_DOS_GRUPOS: GrupoDaLista[] = ['em_cartaz', 'estreia_em_breve', 'ja_disponivel', 'sem_data'];

const ROTULOS: Record<GrupoDaLista, string> = {
  em_cartaz: 'Em cartaz agora',
  estreia_em_breve: 'Estreia em breve',
  ja_disponivel: 'Já disponível',
  sem_data: 'Sem data',
};

/**
 * A lista, já nas trilhas do §8.
 *
 * - `AMBOS` = os filmes que os DOIS querem (as duas linhas ativas);
 * - `CAT`/`BEAR` = a lista de cada um; sem escopo, as duas juntas.
 *
 * Em cartaz é `Availability` aberta de `em_cartaz` ou `pre_estreia` — a mesma
 * fonte da home, para "Na sua lista" e "Em cartaz agora" nunca discordarem.
 * É só consulta (§4.3): nada é gravado quando o filme entra em cartaz.
 */
export async function listarLista(escopo?: EscopoDaLista): Promise<{
  grupos: Array<{ id: GrupoDaLista; titulo: string; itens: ItemDaLista[] }>;
  total: number;
}> {
  const linhas = await prisma.watchlistEntry.findMany({
    where: { removedAt: null, title: { status: { not: 'merged' } } },
    select: {
      pessoa: true,
      interest: true,
      addedAt: true,
      title: {
        select: {
          id: true,
          title: true,
          posterUrl: true,
          year: true,
          status: true,
          imdbRating: true,
          rtRating: true,
          releaseDate: true,
          releaseDateBr: true,
          releaseDateOriginal: true,
          availabilities: {
            where: { source: 'cinema', endedAt: null, status: { in: ['em_cartaz', 'pre_estreia'] } },
            select: { status: true },
          },
        },
      },
    },
  });

  const hoje = diaNoFuso(new Date(), await fusoDaCidade());

  type Titulo = (typeof linhas)[number]['title'];
  const porTitulo = new Map<string, { titulo: Titulo; quem: QuemQuer[] }>();
  for (const l of linhas) {
    const atual = porTitulo.get(l.title.id) ?? { titulo: l.title, quem: [] };
    atual.quem.push({ pessoa: l.pessoa, interesse: l.interest, adicionadoEm: l.addedAt });
    porTitulo.set(l.title.id, atual);
  }

  const itens: ItemDaLista[] = [];
  for (const { titulo, quem } of porTitulo.values()) {
    const pessoas = new Set(quem.map((q) => q.pessoa));
    if (escopo === 'AMBOS' && pessoas.size < 2) continue;
    if ((escopo === 'CAT' || escopo === 'BEAR') && !pessoas.has(escopo)) continue;

    // a do Brasil quando há; senão a original; o `releaseDate` antigo cobre o
    // título que ainda não passou pelo refresh com as colunas novas
    const data = titulo.releaseDateBr ?? titulo.releaseDateOriginal ?? titulo.releaseDate;
    const estreia = data ? data.toISOString().slice(0, 10) : null;

    const grupo: GrupoDaLista =
      titulo.availabilities.length > 0
        ? 'em_cartaz'
        : !estreia
          ? 'sem_data'
          : estreia > hoje
            ? 'estreia_em_breve'
            : 'ja_disponivel';

    itens.push({
      titleId: titulo.id,
      titulo: titulo.title,
      posterUrl: titulo.posterUrl,
      ano: titulo.year,
      orfao: titulo.status === 'orphan',
      imdb: formatarNotaImdb(titulo.imdbRating === null ? null : Number(titulo.imdbRating)),
      rt: formatarNotaRt(titulo.rtRating),
      estreia,
      estreiaMundial: !titulo.releaseDateBr && Boolean(estreia),
      // CAT antes de BEAR, como em todo card — a ordem do enum, não a alfabética
      quem: quem.sort((a, b) => ORDEM_DAS_PESSOAS.indexOf(a.pessoa) - ORDEM_DAS_PESSOAS.indexOf(b.pessoa)),
      grupo,
    });
  }

  const maisRecente = (i: ItemDaLista) => Math.max(...i.quem.map((q) => q.adicionadoEm.getTime()));

  const grupos = ORDEM_DOS_GRUPOS.map((id) => {
    const doGrupo = itens.filter((i) => i.grupo === id);
    // "Estreia em breve" pela data (§8); os outros, o que entrou por último primeiro
    doGrupo.sort((a, b) =>
      id === 'estreia_em_breve'
        ? (a.estreia ?? '').localeCompare(b.estreia ?? '') || a.titulo.localeCompare(b.titulo, 'pt-BR')
        : maisRecente(b) - maisRecente(a),
    );
    return { id, titulo: ROTULOS[id], itens: doGrupo };
  });

  return { grupos, total: itens.length };
}
