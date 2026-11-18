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

export interface ProvedorNormalizado {
  tmdbId: number;
  nome: string;
  logoUrl: string | null;
  tipo: 'flatrate' | 'free' | 'ads' | 'rent' | 'buy';
  prioridade: number | null;
}

export interface MetadataNormalizada {
  tmdbId: number;
  /** ponte para o OMDb; null significa "sem notas possíveis" */
  imdbId: string | null;
  tvdbId: number | null;

  title: string;
  originalTitle: string | null;
  overview: string | null;
  /**
   * Idioma de `overview`: o principal (`pt-BR`) ou o de reserva, quando a
   * sinopse em português veio vazia e `obterMetadata` foi buscar a outra.
   * `null` quando não há sinopse em idioma nenhum.
   */
  overviewLanguage: string | null;
  /** Rumored, Planned, In Production, Post Production, Released, Canceled… */
  productionStatus: string | null;
  runtimeMinutes: number | null;
  /** estreia ORIGINAL (o `release_date` do TMDB) */
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
  /**
   * Onde assistir no país configurado (`TMDB_REGION`). `null` quando a
   * resposta não trouxe o bloco `watch/providers` (pedido sem o append) —
   * diferente de `[]`, que é "o TMDB diz que não está em serviço nenhum".
   */
  provedores: ProvedorNormalizado[] | null;
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
