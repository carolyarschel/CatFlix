import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import type { MetadataNormalizada, TmdbClient } from '../tmdb';
import { aguardarImportacao, aplicarImportacao, esquecerImportacao, iniciarSimulacao } from './importacao.cg.tarefa';

/**
 * A importação pela tela (upload → simulação → aplicar), com um dump
 * SINTÉTICO e um TMDB falso, contra o banco de desenvolvimento.
 */

const PREFIXO = '__teste__tarefa';
const TMDB_ID = 990_300_001;
const T = '\t';
const N = String.fromCharCode(92) + 'N';
const FIM = String.fromCharCode(92) + '.';
// ids que não existem no CG real: o banco de desenvolvimento já tem a importação real

const DUMP = [
  'COPY public.activities (id, type, title, activity_date, who_did, location, collection_id, duration_minutes) FROM stdin;',
  ['990001', 'filme', `${PREFIXO} Filme`, '2024-03-10', 'both', 'cinema', '990010', '120'].join(T),
  FIM,
  '',
  'COPY public.collections (id, collection_type, title, release_date, director, duration_minutes, tmdb_id, who_did, status, status_cat, status_bear, interest_cat, interest_bear, rating_cat, rating_bear, notes_cat, notes_bear, favorite_cat, favorite_bear) FROM stdin;',
  ['990010', 'filme', `${PREFIXO} Filme`, '2024-02-01', 'Diretora X', '120', N, 'both', 'concluido', N, N, N, N, '9', N, N, N, 'f', 'f'].join(T),
  FIM,
  '',
].join('\n');

const tmdbFalso = {
  async buscarFilmes() {
    return {
      dados: { page: 1, total_results: 1, total_pages: 1, results: [{ id: TMDB_ID, title: `${PREFIXO} Filme`, release_date: '2024-02-01' }] },
      rawPayloadId: 'x',
    };
  },
  async buscarDiretores() {
    return ['Diretora X'];
  },
  async obterMetadata(): Promise<MetadataNormalizada> {
    return {
      tmdbId: TMDB_ID, imdbId: null, tvdbId: null, title: `${PREFIXO} Filme`, originalTitle: null, overview: null,
      overviewLanguage: null, productionStatus: 'Released', runtimeMinutes: 120,
      releaseDate: new Date('2024-02-01T00:00:00Z'), year: 2024, releaseDateBr: null, yearBr: null, posterUrl: null,
      backdropUrl: null, genres: [], provedores: null, companies: [], credits: [],
    };
  },
} as unknown as TmdbClient;

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
  esquecerImportacao();
  if (temBanco) await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

describe('importação pela tela', () => {
  it('simula, mostra o relatório, aplica — e não aplica duas vezes', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const inicio = iniciarSimulacao(DUMP, 'catflix', tmdbFalso);
    expect(inicio).toMatchObject({ fase: 'casando', total: 1, por: 'catflix', relatorio: null });
    // outra enquanto esta roda: recusa
    expect(() => iniciarSimulacao(DUMP, 'hburso', tmdbFalso)).toThrow(ConflictError);

    const simulada = await aguardarImportacao(inicio.id);
    expect(simulada.fase).toBe('pronto');
    expect(simulada.relatorio?.totais).toMatchObject({ filmes: 1, certos: 1, visualizacoes: 1, notas: 1 });
    // simular não grava nada
    expect(await prisma.watch.count({ where: { title: { title: { startsWith: PREFIXO } } } })).toBe(0);

    aplicarImportacao(inicio.id, tmdbFalso);
    const aplicada = await aguardarImportacao(inicio.id);
    expect(aplicada.fase).toBe('aplicado');
    expect(await prisma.watch.count({ where: { title: { title: { startsWith: PREFIXO } } } })).toBe(1);

    expect(() => aplicarImportacao(inicio.id, tmdbFalso)).toThrow(ConflictError);
  });

  it('arquivo que não é dump do CG é recusado na hora', () => {
    expect(() => iniciarSimulacao('isto não é um dump', 'catflix', tmdbFalso)).toThrow(ValidationError);
  });
});
