import { describe, expect, it } from 'vitest';
import duna from './__fixtures__/movie-duna-parte-2.json';
import buscaDune from './__fixtures__/search-dune-part-two.json';
import buscaVazia from './__fixtures__/search-sem-resultado.json';
import {
  anoDeLancamento,
  dataDeLancamento,
  nomesParaMatching,
  normalizarCandidato,
  normalizarCreditos,
  normalizarMetadata,
} from './tmdb.parse';
import { tmdbMovieSchema, tmdbSearchResponseSchema } from './tmdb.schemas';

/** Fixtures reais do TMDB, capturadas em 22/09/2026. */

describe('schemas contra payload real', () => {
  it('valida o detalhe de Duna: Parte Dois', () => {
    expect(tmdbMovieSchema.safeParse(duna).success).toBe(true);
  });

  it('valida a busca', () => {
    expect(tmdbSearchResponseSchema.safeParse(buscaDune).success).toBe(true);
  });

  it('busca sem resultado é ausência, não erro', () => {
    const r = tmdbSearchResponseSchema.safeParse(buscaVazia);
    expect(r.success).toBe(true);
    expect(r.success && r.data.total_results).toBe(0);
    expect(r.success && r.data.results).toEqual([]);
  });
});

describe('normalizarMetadata', () => {
  const metadata = normalizarMetadata(tmdbMovieSchema.parse(duna));

  it('extrai o que o catálogo precisa', () => {
    expect(metadata.tmdbId).toBe(693134);
    expect(metadata.title).toBe('Duna: Parte Dois');
    expect(metadata.originalTitle).toBe('Dune: Part Two');
    expect(metadata.runtimeMinutes).toBe(166);
    expect(metadata.year).toBe(2024);
  });

  it('traz o imdb_id, que é a ponte para o OMDb', () => {
    expect(metadata.imdbId).toBe('tt15239678');
  });

  it('monta URL absoluta de pôster e backdrop', () => {
    expect(metadata.posterUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w500\//);
    expect(metadata.backdropUrl).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w1280\//);
  });

  it('traz gêneros e estúdios', () => {
    expect(metadata.genres.map((g) => g.name)).toContain('Ficção científica');
    expect(metadata.companies.length).toBeGreaterThan(0);
  });
});

describe('créditos', () => {
  const creditos = normalizarCreditos(tmdbMovieSchema.parse(duna));

  it('tira o diretor do crew com job Director', () => {
    const diretores = creditos.filter((c) => c.role === 'director');
    expect(diretores.map((d) => d.name)).toEqual(['Denis Villeneuve']);
  });

  it('respeita o limite de elenco principal e a ordem do TMDB', () => {
    const elenco = creditos.filter((c) => c.role === 'cast');
    expect(elenco.length).toBeLessThanOrEqual(12);
    const ordens = elenco.map((e) => e.order ?? 999);
    expect([...ordens].sort((a, b) => a - b)).toEqual(ordens);
  });

  it('entrega os nomes que o score de crédito vai comparar', () => {
    const { diretores, elenco } = nomesParaMatching(normalizarMetadata(tmdbMovieSchema.parse(duna)));
    expect(diretores).toContain('Denis Villeneuve');
    expect(elenco.length).toBeGreaterThan(0);
  });
});

describe('candidatos de busca', () => {
  it('normaliza o que o matching precisa para pontuar', () => {
    const resposta = tmdbSearchResponseSchema.parse(buscaDune);
    const candidato = normalizarCandidato(resposta.results[0]!);

    expect(candidato.tmdbId).toBe(693134);
    expect(candidato.originalTitle).toBe('Dune: Part Two');
    expect(candidato.year).toBe(2024);
  });
});

describe('datas', () => {
  it('converte data de lançamento', () => {
    expect(dataDeLancamento('2024-02-27')?.toISOString()).toBe('2024-02-27T00:00:00.000Z');
    expect(anoDeLancamento('2024-02-27')).toBe(2024);
  });

  it('tolera data vazia — filme sem estreia definida é comum', () => {
    expect(dataDeLancamento('')).toBeNull();
    expect(dataDeLancamento(null)).toBeNull();
    expect(anoDeLancamento(undefined)).toBeNull();
  });
});

describe('estreia no Brasil', () => {
  it('extrai a data de cinema brasileira do release_dates', () => {
    const filme = tmdbMovieSchema.parse({
      id: 1,
      title: 'Teste',
      release_date: '2024-12-20',
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ release_date: '2024-12-20T00:00:00.000Z', type: 3 }] },
          {
            iso_3166_1: 'BR',
            release_dates: [
              // estreia de festival (tipo 1) NÃO conta: o que importa é o cartaz
              { release_date: '2024-10-21T00:00:00.000Z', type: 1 },
              { release_date: '2025-02-20T00:00:00.000Z', type: 3 },
            ],
          },
        ],
      },
    });

    const meta = normalizarMetadata(filme);
    expect(meta.year).toBe(2024);
    expect(meta.yearBr).toBe(2025);
    expect(meta.releaseDateBr?.toISOString().slice(0, 10)).toBe('2025-02-20');
  });

  it('sem entrada BR, os campos ficam nulos e nada quebra', () => {
    const filme = tmdbMovieSchema.parse({ id: 1, title: 'Teste', release_date: '2024-01-01' });
    const meta = normalizarMetadata(filme);
    expect(meta.yearBr).toBeNull();
    expect(meta.releaseDateBr).toBeNull();
  });
});
