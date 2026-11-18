import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import type { MetadataNormalizada } from '../tmdb';
import { upsertPorTmdbId } from './catalog.service';

/**
 * Os campos da expansão do acervo no `upsertPorTmdbId` (cineon-expansao §3.1 e
 * §5.2), contra o banco de desenvolvimento.
 */

const TMDB_ID = 990_000_001; // fora da faixa dos ids reais que o teste usa
const PREFIXO = '__teste__metadata';

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
  if (!temBanco) return;
  const ids = await prisma.titleExternalId.findMany({
    where: { source: 'tmdb', externalId: String(TMDB_ID) },
    select: { titleId: true },
  });
  await prisma.title.deleteMany({ where: { id: { in: ids.map((i) => i.titleId) } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

function metadata(parcial: Partial<MetadataNormalizada> = {}): MetadataNormalizada {
  return {
    tmdbId: TMDB_ID,
    imdbId: null,
    tvdbId: null,
    title: `${PREFIXO} Filme`,
    originalTitle: null,
    overview: null,
    overviewLanguage: null,
    productionStatus: 'Released',
    runtimeMinutes: 120,
    releaseDate: new Date('2024-02-27T00:00:00Z'),
    year: 2024,
    releaseDateBr: new Date('2024-02-29T00:00:00Z'),
    yearBr: 2024,
    posterUrl: null,
    backdropUrl: null,
    genres: [],
    provedores: null,
    companies: [],
    credits: [],
    ...parcial,
  };
}

function lerTitle(id: string) {
  return prisma.title.findUniqueOrThrow({
    where: { id },
    select: {
      overview: true,
      overviewLanguage: true,
      productionStatus: true,
      releaseDate: true,
      releaseDateBr: true,
      releaseDateOriginal: true,
    },
  });
}

describe('upsertPorTmdbId — campos da expansão', () => {
  it('grava as duas estreias, o status e o idioma da sinopse', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const id = await prisma.$transaction((tx) =>
      upsertPorTmdbId(tx, metadata({ overview: 'Sinopse.', overviewLanguage: 'pt-BR' })),
    );
    const t = await lerTitle(id);

    expect(t.releaseDateOriginal?.toISOString().slice(0, 10)).toBe('2024-02-27');
    expect(t.releaseDateBr?.toISOString().slice(0, 10)).toBe('2024-02-29');
    // o significado antigo de `releaseDate` não muda: BR quando há
    expect(t.releaseDate?.toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(t.productionStatus).toBe('Released');
    expect(t.overviewLanguage).toBe('pt-BR');
  });

  it('metadata sem sinopse não apaga a sinopse em inglês que já estava lá', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // o refresh trouxe a sinopse no idioma de reserva…
    const id = await prisma.$transaction((tx) =>
      upsertPorTmdbId(tx, metadata({ overview: 'An overview.', overviewLanguage: 'en-US' })),
    );
    // …e depois o matching do cinema, que não busca a reserva, grava de novo
    await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata({ productionStatus: 'Released' })));

    const t = await lerTitle(id);
    expect(t.overview).toBe('An overview.');
    expect(t.overviewLanguage).toBe('en-US');
  });

  it('sinopse em português nova substitui a em inglês', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const id = await prisma.$transaction((tx) =>
      upsertPorTmdbId(tx, metadata({ overview: 'An overview.', overviewLanguage: 'en-US' })),
    );
    await prisma.$transaction((tx) =>
      upsertPorTmdbId(tx, metadata({ overview: 'Uma sinopse.', overviewLanguage: 'pt-BR' })),
    );

    const t = await lerTitle(id);
    expect(t.overview).toBe('Uma sinopse.');
    expect(t.overviewLanguage).toBe('pt-BR');
  });
});

describe('upsertPorTmdbId — provedores de streaming (§6)', () => {
  const hbo = { tmdbId: 1899, nome: 'HBO Max', logoUrl: null, tipo: 'flatrate' as const, prioridade: 1 };
  const apple = { tmdbId: 2, nome: 'Apple TV Store', logoUrl: null, tipo: 'rent' as const, prioridade: 3 };

  async function provedores(id: string) {
    return (
      await prisma.titleProvider.findMany({ where: { titleId: id }, orderBy: { providerId: 'asc' } })
    ).map((p) => `${p.providerId}:${p.type}`);
  }

  it('grava, mantém quando o bloco não veio, e esvazia quando veio vazio', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const id = await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata({ provedores: [hbo, apple] })));
    expect(await provedores(id)).toEqual(['2:rent', '1899:flatrate']);
    const lido = (await prisma.title.findUniqueOrThrow({ where: { id } })).providersUpdatedAt;
    expect(lido).not.toBeNull();

    // matching sem o bloco: não diz nada sobre streaming, não apaga
    await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata({ provedores: null })));
    expect(await provedores(id)).toEqual(['2:rent', '1899:flatrate']);

    // o TMDB diz que saiu de tudo: aí sim esvazia, e marca a leitura
    await prisma.$transaction((tx) => upsertPorTmdbId(tx, metadata({ provedores: [] })));
    expect(await provedores(id)).toEqual([]);
  });
});
