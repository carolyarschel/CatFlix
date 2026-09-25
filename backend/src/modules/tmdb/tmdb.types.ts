/**
 * Metadata normalizada do TMDB, pronta para virar `Title` + relações.
 *
 * Como no módulo ingresso, aqui não há `titleId`: quem amarra ao catálogo é o
 * `catalog`/`sync`. Este módulo só sabe falar TMDB.
 */

export interface CreditoNormalizado {
  tmdbId: number;
  name: string;
  profileUrl: string | null;
  role: 'director' | 'cast';
  character: string | null;
  order: number | null;
}

export interface MetadataNormalizada {
  tmdbId: number;
  /** ponte para o OMDb; null significa "sem notas possíveis" */
  imdbId: string | null;
  tvdbId: number | null;

  title: string;
  originalTitle: string | null;
  overview: string | null;
  runtimeMinutes: number | null;
  releaseDate: Date | null;
  year: number | null;
  /**
   * Estreia nos cinemas BRASILEIROS, quando o TMDB conhece.
   *
   * Existe porque o ano que o ingresso publica costuma ser o daqui, e ele
   * diverge do global com frequência: *O Brutalista* é 2024 lá fora e
   * 2025-02-20 aqui. Sem este campo, o match perde meio ponto de ano num
   * filme que está perfeitamente certo.
   */
  releaseDateBr: Date | null;
  yearBr: number | null;

  posterUrl: string | null;
  backdropUrl: string | null;

  genres: Array<{ tmdbId: number; name: string }>;
  companies: Array<{ tmdbId: number; name: string; logoUrl: string | null; originCountry: string | null }>;
  credits: CreditoNormalizado[];
}

/** Candidato de busca, com o mínimo que o matching precisa para pontuar. */
export interface CandidatoTmdb {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: Date | null;
  overview: string | null;
  posterUrl: string | null;
  popularity: number | null;
}
