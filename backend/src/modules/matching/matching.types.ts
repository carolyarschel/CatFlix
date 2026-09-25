import type { MatchOutcome, MatchStage, ReviewReason } from '@prisma/client';
import type { ResultadoDoScore } from './matching.score';
import type { ResultadoTriagem } from './matching.triage';

/** O evento do ingresso, com o que o matching precisa para decidir. */
export interface EventoParaMatching {
  ingressoEventId: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  distributor: string | null;
  /**
   * Página do filme no ingresso.com (`movies[].siteURL`, CONTRATO.md §4.3).
   *
   * Não entra em nenhum score: o matching não olha para ela. Viaja junto porque
   * é aqui que o evento do ingresso atravessa o sync inteiro, e o §1 pede esse
   * link no botão do detalhe.
   */
  siteUrl: string | null;
  /** o ingresso manda como string; quem quebrou em lista foi o módulo de fonte */
  directorNames: string[];
  castNames: string[];
}

/** Um `Title` que já existe no catálogo — candidato de deduplicação (§7.3). */
export interface TituloExistente {
  id: string;
  title: string;
  normalizedTitle: string;
  normalizedOriginalTitle: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  tmdbId: number | null;
}

/** Candidato do TMDB, já com o detalhe que o score precisa. */
export interface CandidatoAvaliado {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  /**
   * Data de estreia do candidato. Serve para saber se o ANO é um fato ou uma
   * estimativa: filme já lançado tem ano fixo; filme futuro tem ano que muda
   * de um mês para o outro, e que ingresso e TMDB raramente concordam.
   */
  releaseDate?: Date | null;
  /** ano e data da estreia nos cinemas brasileiros */
  yearBr?: number | null;
  releaseDateBr?: Date | null;
  runtimeMinutes: number | null;
  genres: string[];
  directorNames: string[];
  castNames: string[];
}

/**
 * De onde o motor tira informação. É uma porta, não uma dependência concreta:
 * assim os quatro testes do §7.4 rodam sem banco e sem rede, e a implementação
 * real (Postgres + TMDB) fica em `matching.sources.ts`.
 */
export interface FontesDeMatching {
  /** estágio 0: este id do ingresso já foi decidido antes? */
  buscarDecisaoEmCache(ingressoEventId: string): Promise<{ titleId: string } | null>;
  /** estágio 3: títulos do catálogo parecidos, por trigrama indexado */
  buscarTitulosParecidos(normalizado: string): Promise<TituloExistente[]>;
  /** estágios 2 e 3: candidatos do TMDB */
  buscarCandidatosTmdb(query: string, ano: number | null): Promise<CandidatoAvaliado[]>;
}

/**
 * O que um estágio devolve quando resolve o caso. O motor acrescenta a versão
 * do normalizador e a query normalizada, que valem para a decisão inteira.
 */
export type ResultadoDeEstagio = Omit<DecisaoDeMatching, 'normalizerVersion' | 'normalizedQuery'>;

export interface DecisaoDeMatching {
  stage: MatchStage;
  outcome: MatchOutcome;
  /** preenchido quando a decisão aponta para um Title que já existe */
  titleId?: string;
  candidateTmdbId?: number;
  candidateLabel?: string;
  score?: ResultadoDoScore;
  triagem?: ResultadoTriagem;
  /** motivo do ReviewItem, quando `outcome` manda para revisão */
  reviewReason?: ReviewReason;
  reason: string;
  /** versão da configuração do normalizador, para a decisão seguir explicável */
  normalizerVersion: string;
  normalizedQuery: string;
}
