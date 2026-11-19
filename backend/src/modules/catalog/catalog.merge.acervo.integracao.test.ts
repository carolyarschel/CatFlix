import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { mergeTitles } from './catalog.merge';

/**
 * O merge leva o acervo do casal junto (cineon-expansao). É o caminho de todo
 * filme importado do CG com baixa confiança: ele nasce órfão, recebe as
 * visualizações, e é unido ao filme do TMDB quando a Carol resolve a pendência.
 */

const PREFIXO = '__teste__merge_acervo';

let temBanco = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterEach(async () => {
  if (temBanco) await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string, status: 'matched' | 'orphan' = 'matched') {
  return prisma.title.create({
    data: { title: `${PREFIXO}${sufixo}`, normalizedTitle: `${PREFIXO}${sufixo}`, status },
    select: { id: true },
  });
}

describe('mergeTitles — acervo', () => {
  it('leva visualizações, lista e notas; na colisão, vence a ativa e a mais recente', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const orfao = await titulo('-orfao', 'orphan');
    const tmdb = await titulo('-tmdb');

    // o órfão importado
    await prisma.watch.create({
      data: { titleId: orfao.id, watchedOn: new Date('2019-01-17'), location: 'CINEMA', participants: ['CAT'] },
    });
    await prisma.watchlistEntry.create({ data: { titleId: orfao.id, pessoa: 'CAT', interest: 4 } });
    await prisma.watchlistEntry.create({ data: { titleId: orfao.id, pessoa: 'BEAR' } });
    await prisma.rating.create({ data: { titleId: orfao.id, pessoa: 'CAT', score: new Prisma.Decimal(8) } });

    // o filme do TMDB já tinha: a CAT tirou da lista, e uma nota velha dela
    await prisma.watchlistEntry.create({
      data: { titleId: tmdb.id, pessoa: 'CAT', interest: null, removedAt: new Date('2026-01-01') },
    });
    await prisma.rating.create({
      data: {
        titleId: tmdb.id,
        pessoa: 'CAT',
        score: new Prisma.Decimal(6),
        updatedAt: new Date('2020-01-01'),
      },
    });

    const r = await mergeTitles(orfao.id, tmdb.id, { reason: 'teste' });

    expect(r.repontados).toMatchObject({ watches: 1, watchlist: 2, ratings: 1 });
    expect(await prisma.watch.count({ where: { titleId: tmdb.id } })).toBe(1);

    const lista = await prisma.watchlistEntry.findMany({ where: { titleId: tmdb.id }, orderBy: { pessoa: 'asc' } });
    expect(lista.map((l) => [l.pessoa, l.removedAt === null, l.interest])).toEqual([
      ['CAT', true, 4],
      ['BEAR', true, null],
    ]);

    const notas = await prisma.rating.findMany({ where: { titleId: tmdb.id } });
    expect(notas.map((n) => Number(n.score))).toEqual([8]);

    // nada ficou preso no absorvido
    expect(await prisma.watchlistEntry.count({ where: { titleId: orfao.id } })).toBe(0);
    expect(await prisma.rating.count({ where: { titleId: orfao.id } })).toBe(0);
    expect((await prisma.title.findUniqueOrThrow({ where: { id: orfao.id } })).status).toBe('merged');
  });
});
