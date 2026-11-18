import type { DatePrecision, Pessoa, Prisma, WatchLocation } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { formatarNotaImdb, formatarNotaRt } from '../catalog/catalog.format';
import type { CardDeTitulo, MarcaDeUsuario } from '../catalog/catalog.types';

/**
 * A aba "Assistidos" (cineon-expansao §8): um card por FILME — rever não
 * duplica o pôster —, do assistido mais recentemente para o mais antigo.
 *
 * Mora no orquestrador, e não em `watches`, porque os filtros cruzam tabelas
 * que `watches` não conhece: gênero e diretor (catálogo) e nota (`ratings`).
 *
 * O card é o mesmo `CardDeTitulo` das trilhas (§8: "todos os cards de pôster
 * continuam idênticos"); muda o conteúdo — a faixa do rodapé é a data em que
 * assistiram, e os rostos no canto são quem assistiu.
 */

export interface FiltrosDosAssistidos {
  /** `AMBOS` = filmes que os dois viram juntos */
  pessoa?: Pessoa | 'AMBOS';
  local?: WatchLocation;
  /** ano em que ASSISTIRAM, não o do filme */
  ano?: number;
  q?: string;
  /** nome do gênero, como o TMDB devolve em pt-BR */
  genero?: string;
  /** trecho do nome do diretor */
  diretor?: string;
  /** algum dos dois deu nota maior ou igual a esta */
  notaMin?: number;
  pagina?: number;
}

export interface CardDoAssistido extends CardDeTitulo {
  /** a visualização mais recente, como foi dita */
  ultimaVez: { data: string; precisao: DatePrecision };
  vezes: number;
  notas: Array<{ pessoa: Pessoa; nota: number }>;
}

const POR_PAGINA = 60;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dataDita(data: Date, precisao: DatePrecision): string {
  const iso = data.toISOString().slice(0, 10);
  if (precisao === 'ANO') return iso.slice(0, 4);
  if (precisao === 'MES') return iso.slice(0, 7);
  return iso;
}

/** A faixa do pôster: "14/11/2026", "jul 2019" ou "2019". */
function faixaDaData(data: Date, precisao: DatePrecision): string {
  const [ano, mes, dia] = data.toISOString().slice(0, 10).split('-');
  if (precisao === 'ANO') return ano!;
  if (precisao === 'MES') return `${MESES[Number(mes) - 1]} ${ano}`;
  return `${dia}/${mes}/${ano}`;
}

export async function listarAssistidos(filtros: FiltrosDosAssistidos): Promise<{
  itens: CardDoAssistido[];
  total: number;
  proximaPagina: number | null;
  facetas: { anos: number[]; generos: string[] };
}> {
  const pagina = Math.max(filtros.pagina ?? 1, 1);

  const where: Prisma.WatchWhereInput = {
    removedAt: null,
    ...(filtros.pessoa === 'AMBOS'
      ? { participants: { hasEvery: ['CAT', 'BEAR'] } }
      : filtros.pessoa
        ? { participants: { has: filtros.pessoa } }
        : {}),
    ...(filtros.local ? { location: filtros.local } : {}),
    ...(filtros.ano
      ? {
          watchedOn: {
            gte: new Date(Date.UTC(filtros.ano, 0, 1)),
            lt: new Date(Date.UTC(filtros.ano + 1, 0, 1)),
          },
        }
      : {}),
    title: {
      status: { not: 'merged' },
      ...(filtros.q
        ? {
            OR: [
              { title: { contains: filtros.q, mode: 'insensitive' } },
              { originalTitle: { contains: filtros.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filtros.genero ? { genres: { some: { genre: { name: filtros.genero } } } } : {}),
      ...(filtros.diretor
        ? {
            credits: {
              some: {
                role: 'director',
                person: { name: { contains: filtros.diretor, mode: 'insensitive' } },
              },
            },
          }
        : {}),
      ...(filtros.notaMin !== undefined
        ? { ratings: { some: { removedAt: null, score: { gte: filtros.notaMin } } } }
        : {}),
    },
  };

  const [visualizacoes, usuarios, facetas] = await Promise.all([
    prisma.watch.findMany({
      where,
      orderBy: [{ watchedOn: 'desc' }, { createdAt: 'desc' }],
      select: {
        watchedOn: true,
        datePrecision: true,
        participants: true,
        location: true,
        cinemaFreeName: true,
        cinema: { select: { name: true } },
        title: {
          select: {
            id: true,
            title: true,
            posterUrl: true,
            year: true,
            status: true,
            imdbRating: true,
            rtRating: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { papel: { not: null } },
      select: { id: true, papel: true, initial: true, accent: true, displayName: true },
    }),
    facetasDosAssistidos(),
  ]);

  // agrupa por filme; a primeira linha de cada um é a mais recente (orderBy)
  type Linha = (typeof visualizacoes)[number];
  const porTitulo = new Map<string, { ultima: Linha; vezes: number; quem: Set<Pessoa> }>();
  for (const v of visualizacoes) {
    const atual = porTitulo.get(v.title.id);
    if (atual) {
      atual.vezes += 1;
      v.participants.forEach((p) => atual.quem.add(p));
    } else {
      porTitulo.set(v.title.id, { ultima: v, vezes: 1, quem: new Set(v.participants) });
    }
  }

  const total = porTitulo.size;
  const daPagina = [...porTitulo.values()].slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const notas = await prisma.rating.findMany({
    where: { titleId: { in: daPagina.map((g) => g.ultima.title.id) }, removedAt: null },
    orderBy: { pessoa: 'asc' },
    select: { titleId: true, pessoa: true, score: true },
  });

  const marcaDe = new Map<Pessoa, MarcaDeUsuario>(
    usuarios.map((u) => [
      u.papel as Pessoa,
      { userId: u.id, inicial: u.initial, acento: u.accent, nome: u.displayName },
    ]),
  );

  const itens: CardDoAssistido[] = daPagina.map(({ ultima, vezes, quem }) => {
    const t = ultima.title;
    const onde =
      ultima.location === 'CASA' ? 'Em casa' : (ultima.cinema?.name ?? ultima.cinemaFreeName ?? 'No cinema');

    return {
      id: t.id,
      titulo: t.title,
      posterUrl: t.posterUrl,
      ano: t.year,
      orfao: t.status === 'orphan',
      imdb: formatarNotaImdb(t.imdbRating === null ? null : Number(t.imdbRating)),
      rt: formatarNotaRt(t.rtRating),
      linha: vezes > 1 ? `${onde} · ${vezes} vezes` : onde,
      // CAT antes de BEAR, como em todo card
      marcadoPor: (['CAT', 'BEAR'] as const)
        .filter((p) => quem.has(p))
        .map((p) => marcaDe.get(p))
        .filter((m): m is MarcaDeUsuario => Boolean(m)),
      faixa: faixaDaData(ultima.watchedOn, ultima.datePrecision),
      ultimaVez: { data: dataDita(ultima.watchedOn, ultima.datePrecision), precisao: ultima.datePrecision },
      vezes,
      notas: notas
        .filter((n) => n.titleId === t.id)
        .map((n) => ({ pessoa: n.pessoa, nota: Number(n.score) })),
    };
  });

  return {
    itens,
    total,
    proximaPagina: pagina * POR_PAGINA < total ? pagina + 1 : null,
    facetas,
  };
}

/**
 * Os valores que os filtros oferecem: só anos em que vocês assistiram a algo
 * e só gêneros de filmes que vocês viram — um filtro que só sabe devolver
 * vazio não ajuda.
 */
async function facetasDosAssistidos(): Promise<{ anos: number[]; generos: string[] }> {
  const [anos, generos] = await Promise.all([
    prisma.$queryRaw<Array<{ ano: number }>>`
      SELECT DISTINCT extract(year FROM watched_on)::int AS ano
      FROM watches WHERE removed_at IS NULL ORDER BY 1 DESC
    `,
    prisma.genre.findMany({
      where: { titles: { some: { title: { watches: { some: { removedAt: null } } } } } },
      orderBy: { name: 'asc' },
      select: { name: true },
    }),
  ]);

  return { anos: anos.map((a) => a.ano), generos: generos.map((g) => g.name) };
}
