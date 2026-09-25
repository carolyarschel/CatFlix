import { tmdbConfig, urlDeImagemTmdb } from '../../config/metadata';
import type { CandidatoTmdb, CreditoNormalizado, MetadataNormalizada } from './tmdb.types';
import type { TmdbMovie, TmdbSearchResult } from './tmdb.schemas';

/** "2024-02-27" → Date. Vazio, "" ou lixo → null. */
export function dataDeLancamento(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(`${valor}T00:00:00Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function anoDeLancamento(valor: string | null | undefined): number | null {
  const data = dataDeLancamento(valor);
  return data ? data.getUTCFullYear() : null;
}

/** `runtime` vem 0 em filme não lançado; 0 minuto não é duração. */
function minutos(runtime: number | null | undefined): number | null {
  return typeof runtime === 'number' && runtime > 0 ? runtime : null;
}

export function normalizarCandidato(bruto: TmdbSearchResult): CandidatoTmdb {
  return {
    tmdbId: bruto.id,
    title: bruto.title,
    originalTitle: bruto.original_title ?? null,
    year: anoDeLancamento(bruto.release_date),
    releaseDate: dataDeLancamento(bruto.release_date),
    overview: bruto.overview ?? null,
    posterUrl: urlDeImagemTmdb(bruto.poster_path, 'poster'),
    popularity: bruto.popularity ?? null,
  };
}

/**
 * Diretor sai do crew com `job === 'Director'`; elenco principal são os
 * primeiros N do cast, na ordem que o TMDB já entrega (§5.2).
 */
export function normalizarCreditos(filme: TmdbMovie): CreditoNormalizado[] {
  const creditos: CreditoNormalizado[] = [];
  const jaVistos = new Set<string>();

  for (const pessoa of filme.credits?.crew ?? []) {
    if (pessoa.job !== 'Director') continue;
    const chave = `director:${pessoa.id}`;
    if (jaVistos.has(chave)) continue;
    jaVistos.add(chave);

    creditos.push({
      tmdbId: pessoa.id,
      name: pessoa.name,
      profileUrl: urlDeImagemTmdb(pessoa.profile_path, 'perfil'),
      role: 'director',
      character: null,
      order: null,
    });
  }

  const elenco = [...(filme.credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, tmdbConfig.castLimit);

  for (const pessoa of elenco) {
    const chave = `cast:${pessoa.id}`;
    if (jaVistos.has(chave)) continue;
    jaVistos.add(chave);

    creditos.push({
      tmdbId: pessoa.id,
      name: pessoa.name,
      profileUrl: urlDeImagemTmdb(pessoa.profile_path, 'perfil'),
      role: 'cast',
      character: pessoa.character ?? null,
      order: pessoa.order ?? null,
    });
  }

  return creditos;
}

/**
 * Estreia nos cinemas brasileiros, do bloco `release_dates`.
 *
 * `type` 3 é lançamento em cinema; 2 é cinema limitado. Ignoramos 1 (estreia
 * de festival), 4 (digital), 5 (físico) e 6 (TV) — o que interessa é quando o
 * filme entrou em cartaz aqui, que é o ano que o ingresso costuma publicar.
 */
export function estreiaNoBrasil(filme: TmdbMovie): Date | null {
  const brasil = filme.release_dates?.results?.find((r) => r.iso_3166_1 === 'BR');
  if (!brasil?.release_dates?.length) return null;

  const cinema = brasil.release_dates
    .filter((d) => d.type === 3 || d.type === 2)
    .map((d) => new Date(d.release_date))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  return cinema[0] ?? null;
}

export function normalizarMetadata(filme: TmdbMovie): MetadataNormalizada {
  const estreiaBr = estreiaNoBrasil(filme);

  return {
    tmdbId: filme.id,
    imdbId: filme.external_ids?.imdb_id || null,
    tvdbId: filme.external_ids?.tvdb_id ?? null,

    title: filme.title,
    originalTitle: filme.original_title ?? null,
    overview: filme.overview || null,
    runtimeMinutes: minutos(filme.runtime),
    releaseDate: dataDeLancamento(filme.release_date),
    year: anoDeLancamento(filme.release_date),
    releaseDateBr: estreiaBr,
    yearBr: estreiaBr ? estreiaBr.getUTCFullYear() : null,

    posterUrl: urlDeImagemTmdb(filme.poster_path, 'poster'),
    backdropUrl: urlDeImagemTmdb(filme.backdrop_path, 'backdrop'),

    genres: (filme.genres ?? []).map((g) => ({ tmdbId: g.id, name: g.name })),
    companies: (filme.production_companies ?? []).map((c) => ({
      tmdbId: c.id,
      name: c.name,
      logoUrl: urlDeImagemTmdb(c.logo_path, 'logo'),
      originCountry: c.origin_country ?? null,
    })),
    credits: normalizarCreditos(filme),
  };
}

/** Nomes de diretor e elenco, para o componente de crédito do score (§7.2). */
export function nomesParaMatching(metadata: MetadataNormalizada): {
  diretores: string[];
  elenco: string[];
} {
  return {
    diretores: metadata.credits.filter((c) => c.role === 'director').map((c) => c.name),
    elenco: metadata.credits.filter((c) => c.role === 'cast').map((c) => c.name),
  };
}
