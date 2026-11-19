import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import type { MetadataNormalizada, TmdbClient } from '../tmdb';
import { importarFilme } from './importacao.cg.aplicar';
import type { FilmeDoCg } from './importacao.cg.leitura';

/**
 * Gravação da importação do CG (cineon-expansao §11), contra o banco de
 * desenvolvimento, com um TMDB falso.
 */

const PREFIXO = '__teste__importacao';
const TMDB_ID = 990_200_001;

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
  await prisma.reviewItem.deleteMany({ where: { ingressoTitle: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

const tmdbFalso = {
  async obterMetadata(): Promise<MetadataNormalizada> {
    return {
      tmdbId: TMDB_ID, imdbId: null, tvdbId: null, title: `${PREFIXO} Do TMDB`, originalTitle: null,
      overview: null, overviewLanguage: null, productionStatus: 'Released', runtimeMinutes: 120,
      releaseDate: new Date('2024-02-01T00:00:00Z'), year: 2024, releaseDateBr: null, yearBr: null,
      posterUrl: null, backdropUrl: null, genres: [], provedores: null, companies: [], credits: [],
    };
  },
} as unknown as TmdbClient;

function filme(sufixo: string, parcial: Partial<FilmeDoCg> = {}): FilmeDoCg {
  return {
    chave: `collection:${PREFIXO}${sufixo}`,
    titulo: `${PREFIXO}${sufixo}`,
    lancamento: '2024-02-01',
    diretor: 'Diretora X',
    duracaoMinutos: 120,
    tmdbId: null,
    visualizacoes: [{ data: '2024-03-10', local: 'CINEMA', participantes: ['CAT', 'BEAR'] }],
    lista: [],
    notas: [{ pessoa: 'CAT', nota: 9 }],
    comentarios: { CAT: 'amei' },
    favoritos: ['CAT'],
    avisos: [],
    ...parcial,
  };
}

describe('importarFilme', () => {
  it('casamento certo: grava no filme do TMDB, e rodar de novo não duplica', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const f = filme('-certo');
    const primeira = await importarFilme(f, { tipo: 'certo', tmdbId: TMDB_ID, como: 'teste' }, tmdbFalso);
    const segunda = await importarFilme(f, { tipo: 'certo', tmdbId: TMDB_ID, como: 'teste' }, tmdbFalso);

    expect(primeira).toMatchObject({ tipo: 'importado', revisao: false });
    expect(segunda).toEqual({ tipo: 'ja_importado', titleId: (primeira as { titleId: string }).titleId });

    const id = (primeira as { titleId: string }).titleId;
    const visualizacoes = await prisma.watch.findMany({ where: { titleId: id } });
    expect(visualizacoes).toHaveLength(1);
    expect(visualizacoes[0]).toMatchObject({ location: 'CINEMA', participants: ['CAT', 'BEAR'], note: null });
    // o comentário do CG é o comentário da pessoa sobre o filme, não a observação da sessão
    expect(await prisma.comment.findMany({ where: { titleId: id }, select: { pessoa: true, text: true } })).toEqual([
      { pessoa: 'CAT', text: 'amei' },
    ]);
    expect((await prisma.rating.findMany({ where: { titleId: id } })).map((r) => Number(r.score))).toEqual([9]);

    const favorito = await prisma.titleTag.findMany({ where: { titleId: id }, select: { tag: { select: { label: true, ownerId: true } } } });
    expect(favorito.map((t) => t.tag)).toEqual([{ label: 'Favorito', ownerId: 'catflix' }]);
  });

  it('item repetido no CG: quem assistiu por um item não fica na lista pelo outro', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const certo = { tipo: 'certo' as const, tmdbId: TMDB_ID, como: 'teste' };

    // a ordem ruim e a boa: lista antes da visualização, e depois do contrário
    const soLista = filme('-repetido-a', { visualizacoes: [], notas: [], favoritos: [], comentarios: {}, lista: [
      { pessoa: 'CAT', interesse: 5 }, { pessoa: 'BEAR', interesse: null },
    ] });
    const soVisto = filme('-repetido-b', { favoritos: [], visualizacoes: [{ data: '2024-03-10', local: 'CASA', participantes: ['CAT'] }] });
    const listaDeNovo = filme('-repetido-c', { visualizacoes: [], notas: [], favoritos: [], comentarios: {}, lista: [{ pessoa: 'CAT', interesse: 3 }] });

    const r = await importarFilme(soLista, certo, tmdbFalso);
    await importarFilme(soVisto, certo, tmdbFalso);
    await importarFilme(listaDeNovo, certo, tmdbFalso);

    const id = (r as { titleId: string }).titleId;
    const ativas = await prisma.watchlistEntry.findMany({ where: { titleId: id, removedAt: null } });
    // CAT viu: saiu da lista e não voltou; BEAR não viu: continua
    expect(ativas.map((a) => a.pessoa)).toEqual(['BEAR']);
  });

  it('dúvida: órfão com os dados e uma pendência da importação na fila', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const f = filme('-duvida', { lista: [{ pessoa: 'BEAR', interesse: 4 }], visualizacoes: [], notas: [], favoritos: [] });
    const r = await importarFilme(
      f,
      { tipo: 'duvida', candidato: { tmdbId: 123, titulo: 'Talvez', tituloOriginal: null, ano: 2024 }, motivo: 'diretor não bate' },
      tmdbFalso,
    );

    expect(r).toMatchObject({ tipo: 'importado', revisao: true });
    const id = (r as { titleId: string }).titleId;
    expect((await prisma.title.findUniqueOrThrow({ where: { id } })).status).toBe('orphan');
    expect(await prisma.watchlistEntry.findMany({ where: { titleId: id } })).toMatchObject([{ pessoa: 'BEAR', interest: 4 }]);

    const pendencia = await prisma.reviewItem.findFirstOrThrow({ where: { subjectTitleId: id } });
    expect(pendencia).toMatchObject({
      origin: 'importacao_cg',
      ingressoEventId: null,
      reason: 'import_low_confidence',
      candidateTmdbId: 123,
      candidateLabel: 'Talvez (2024)',
    });
    expect(pendencia.note).toMatch(/diretor não bate/);
  });
});
