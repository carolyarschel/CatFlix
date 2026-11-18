export { TmdbClient } from './tmdb.client';
export type { TmdbClientOptions, RespostaTmdb } from './tmdb.client';
export {
  anoDeLancamento,
  dataDeLancamento,
  nomesParaMatching,
  normalizarCandidato,
  normalizarCreditos,
  normalizarMetadata,
  precisaAtualizarMetadata,
} from './tmdb.parse';
export type { CandidatoTmdb, CreditoNormalizado, MetadataNormalizada } from './tmdb.types';
export type { TmdbMovie, TmdbSearchResponse, TmdbSearchResult } from './tmdb.schemas';
