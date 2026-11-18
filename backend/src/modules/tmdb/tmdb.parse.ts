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

/**
 * A metadata deste filme já venceu? (cineon-expansao §5.3)
 *
 * Lançamento — ainda não estreou, ou estreou há até 90 dias — vence em 7 dias:
 * elenco, sinopse e data mudam muito nessa fase. O resto, em 90.
 *
 * Sem data, o status de produção decide: filme anunciado ("Planned", "In
 * Production"…) costuma vir sem data e é lançamento; um "Released" sem data é
 * filme antigo que o TMDB nunca datou, e reconsultá-lo toda semana não traria
 * nada.
 */
export function precisaAtualizarMetadata(
  filme: {
    releaseDate: Date | null;
    productionStatus: string | null;
    metadataUpdatedAt: Date | null;
  },
  config: { janelaDeLancamentoDias: number; lancamentoDias: number; acervoDias: number },
  agora = new Date(),
): boolean {
  if (!filme.metadataUpdatedAt) return true;

  const dia = 86_400_000;
  const diasDesdeORefresh = (agora.getTime() - filme.metadataUpdatedAt.getTime()) / dia;

  const lancamento = filme.releaseDate
    ? (agora.getTime() - filme.releaseDate.getTime()) / dia <= config.janelaDeLancamentoDias
    : filme.productionStatus !== 'Released';

  return diasDesdeORefresh >= (lancamento ? config.lancamentoDias : config.acervoDias);
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

/** Códigos de `release_dates[].type` (documentação do TMDB, conferida em 18/11/2026). */
const LANCAMENTO_EM_CINEMA = 3;
const LANCAMENTO_LIMITADO = 2;

/**
 * Estreia nos cinemas do país configurado (`TMDB_REGION`, Brasil), do bloco
 * `release_dates`.
 *
 * Regra (cineon-expansao §5.1): a data de cinema (`type` 3) **mais antiga**; só
 * sem nenhuma, a de cinema limitado (2). Ignoramos 1 (festival), 4 (digital),
 * 5 (físico) e 6 (TV).
 *
 * As duas metades da regra importam, e há caso real para cada uma: *Duna: Parte
 * Dois* tem, no Brasil, tipo 3 em 29/02/2024 e tipo 2 em 03/12/2026 — a
 * reexibição. "Qualquer data de cinema" ou "a mais recente" dariam a da
 * reexibição como estreia.
 */
export function estreiaNoBrasil(filme: TmdbMovie): Date | null {
  const pais = filme.release_dates?.results?.find((r) => r.iso_3166_1 === tmdbConfig.region);
  if (!pais?.release_dates?.length) return null;

  const maisAntigaDoTipo = (tipo: number): Date | null =>
    pais
      .release_dates!.filter((d) => d.type === tipo)
      .map((d) => new Date(d.release_date))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return maisAntigaDoTipo(LANCAMENTO_EM_CINEMA) ?? maisAntigaDoTipo(LANCAMENTO_LIMITADO);
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
    // o pedido sai no idioma principal; `obterMetadata` troca isto quando
    // precisa buscar a sinopse no idioma de reserva
    overviewLanguage: filme.overview ? tmdbConfig.language : null,
    productionStatus: filme.status || null,
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
