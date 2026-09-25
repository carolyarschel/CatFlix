import { z } from 'zod';

/**
 * Schemas do TMDB (§5.2). Mesmo princípio do módulo ingresso: estrito no que
 * alimenta o catálogo, permissivo no resto.
 *
 * O TMDB é bem mais estável e documentado que o ingresso, mas a regra de ouro
 * do projeto não muda: payload que não bate com o schema não atualiza nada.
 */

// ── busca ────────────────────────────────────────────────────

export const tmdbSearchResultSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: z.string().nullish(),
  original_language: z.string().nullish(),
  release_date: z.string().nullish(),
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  popularity: z.number().nullish(),
  vote_average: z.number().nullish(),
  vote_count: z.number().int().nullish(),
  genre_ids: z.array(z.number().int()).nullish(),
  adult: z.boolean().nullish(),
});

export const tmdbSearchResponseSchema = z.object({
  page: z.number().int(),
  /** 0 quando não há resultado — não é erro, é ausência */
  total_results: z.number().int(),
  total_pages: z.number().int(),
  results: z.array(tmdbSearchResultSchema),
});

// ── detalhe ──────────────────────────────────────────────────

const personSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  profile_path: z.string().nullish(),
});

export const tmdbCastSchema = personSchema.extend({
  character: z.string().nullish(),
  order: z.number().int().nullish(),
});

export const tmdbCrewSchema = personSchema.extend({
  /** "Director" é o que interessa (§5.2) */
  job: z.string().nullish(),
  department: z.string().nullish(),
});

export const tmdbMovieSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: z.string().nullish(),
  original_language: z.string().nullish(),
  overview: z.string().nullish(),
  /** minutos; pode vir 0 ou null em filme não lançado */
  runtime: z.number().int().nullish(),
  release_date: z.string().nullish(),
  status: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  vote_count: z.number().int().nullish(),
  genres: z.array(z.object({ id: z.number().int(), name: z.string() })).nullish(),
  production_companies: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        logo_path: z.string().nullish(),
        origin_country: z.string().nullish(),
      }),
    )
    .nullish(),

  // vindos do append_to_response
  credits: z
    .object({
      cast: z.array(tmdbCastSchema).nullish(),
      crew: z.array(tmdbCrewSchema).nullish(),
    })
    .nullish(),
  /**
   * Datas de lançamento por país (do `append_to_response`).
   * `type`: 1 estreia, 2 cinema limitado, 3 CINEMA, 4 digital, 5 físico, 6 TV.
   */
  release_dates: z
    .object({
      results: z
        .array(
          z.object({
            iso_3166_1: z.string(),
            release_dates: z
              .array(z.object({ release_date: z.string(), type: z.number().int().nullish() }))
              .nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
  external_ids: z
    .object({
      /** ponte para o OMDb (§5.3: busca SEMPRE por imdb_id) */
      imdb_id: z.string().nullish(),
      /** previsto para o Sonarr (§13) */
      tvdb_id: z.number().int().nullish(),
    })
    .nullish(),
});

/** Corpo de erro do TMDB: chega com 401 ou 404, sempre com este formato. */
export const tmdbErrorSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string(),
  success: z.boolean().nullish(),
});

export type TmdbSearchResult = z.infer<typeof tmdbSearchResultSchema>;
export type TmdbSearchResponse = z.infer<typeof tmdbSearchResponseSchema>;
export type TmdbMovie = z.infer<typeof tmdbMovieSchema>;
export type TmdbCast = z.infer<typeof tmdbCastSchema>;
export type TmdbCrew = z.infer<typeof tmdbCrewSchema>;
