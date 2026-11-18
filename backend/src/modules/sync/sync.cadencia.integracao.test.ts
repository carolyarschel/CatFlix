import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { cotaDoOmdb } from '../omdb';
import { priorizarNotas } from './sync.jobs';

/**
 * Cota diária do OMDb e a ordem em que ela é gasta (cineon-expansao §5.3).
 */

const ENDPOINT = '__teste__cota';

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
  if (temBanco) await prisma.rawPayload.deleteMany({ where: { endpoint: ENDPOINT } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

describe('priorizarNotas', () => {
  const v = (titleId: string, dias: number | null) => ({
    titleId,
    ratingsUpdatedAt: dias === null ? null : new Date(Date.UTC(2026, 0, 1) - dias * 86_400_000),
  });

  it('em cartaz primeiro, depois nunca consultado, depois o mais antigo', () => {
    const ordem = priorizarNotas(
      [v('acervo-novo', 10), v('nunca', null), v('acervo-velho', 400), v('cinema', 2)],
      new Set(['cinema']),
    ).map((x) => x.titleId);

    expect(ordem).toEqual(['cinema', 'nunca', 'acervo-velho', 'acervo-novo']);
  });
});

describe('cotaDoOmdb', () => {
  it('conta só as chamadas ao OMDb das últimas 24 h', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const agora = new Date();
    const linha = (horasAtras: number, source: 'omdb' | 'tmdb' = 'omdb') => ({
      source,
      endpoint: ENDPOINT,
      bodyHash: 'x',
      body: {},
      httpStatus: 200,
      fetchedAt: new Date(agora.getTime() - horasAtras * 3_600_000),
    });

    const antes = await cotaDoOmdb(1_000_000, agora);
    await prisma.rawPayload.createMany({
      data: [linha(1), linha(23), linha(25), linha(1, 'tmdb')],
    });
    const depois = await cotaDoOmdb(1_000_000, agora);

    // só as duas do OMDb dentro da janela
    expect(depois.usadas - antes.usadas).toBe(2);
  });

  it('restante nunca fica negativo', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    await prisma.rawPayload.createMany({
      data: [1, 2, 3].map(() => ({
        source: 'omdb' as const,
        endpoint: ENDPOINT,
        bodyHash: 'x',
        body: {},
        httpStatus: 200,
      })),
    });
    expect((await cotaDoOmdb(1)).restante).toBe(0);
  });
});
