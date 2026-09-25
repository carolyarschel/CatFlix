import { env } from './env';
import suffixes from './title-suffixes.json';

/**
 * Limiares do matching (§7.2). Vêm do ambiente; os valores aqui são só o
 * fallback documentado. Nenhum número do pipeline é hardcoded no algoritmo.
 */
export const matchThresholds = {
  /** ≥ este valor: aceita automaticamente */
  auto: env.MATCH_AUTO_THRESHOLD,
  /** entre `review` e `auto`: ReviewItem com candidato */
  review: env.MATCH_REVIEW_THRESHOLD,
  /** abaixo de `review`: Title órfão visível + ReviewItem sem candidato */
} as const;

/** Pesos do score composto (§7.2). Somam 1. */
export const matchWeights = {
  title: 0.5,
  runtime: 0.2,
  year: 0.2,
  credits: 0.1,
} as const;

/** Tolerâncias do match forte (§7.2, estágio 2). */
export const matchTolerances = {
  /** aceita o ano com ±1 de diferença */
  yearSlack: 1,
  /** duração pode divergir menos que isto, em minutos */
  runtimeSlackMinutes: 7,
} as const;

/**
 * Triagem "isso é filme?" (§7.2, estágio 1).
 *
 * A §7.2 do contexto supõe que "distribuidor ausente" seja um sinal, e o
 * modelo do ingresso tem um campo `type`. A sondagem da API mostrou que
 * nenhum dos dois funciona como escrito — ver modules/ingresso/CONTRATO.md §5:
 * `type` é sempre "Filme" (inclusive em show e ópera) e o distribuidor vem
 * como a string literal "Sem Distribuidor", nunca nulo.
 *
 * Nenhum sinal sozinho decide: a triagem manda para revisão.
 */
export const triageRules = {
  /** abaixo disto não é longa-metragem */
  minRuntimeMinutes: 40,
  keywords: suffixes.nonFilmKeywords,
  /** valores literais de `distributor` que significam "não tem distribuidora" */
  nonFilmDistributors: suffixes.nonFilmDistributors,
  /** distribuidoras cujo catálogo é show/transmissão, não longa-metragem */
  eventDistributors: suffixes.eventDistributors,
  /**
   * Sinal que só existe DEPOIS de consultar o TMDB, e o mais forte de todos:
   * show e transmissão entram no TMDB como "Música"/"Documentário".
   *
   * Isto importa porque os não-filmes **existem no TMDB e casam bem** — medido:
   * Rammstein, Queen, BTS e Maiara & Maraisa têm entrada lá. Sem a triagem, o
   * matching aceitaria todos com confiança alta.
   */
  eventGenresTmdb: suffixes.eventGenresTmdb,
  /**
   * Combinações de gênero que, juntas, são assinatura de show ou transmissão.
   * "Música" sozinho não serve: `Wicked` é Música+Fantasia e é filme.
   */
  eventGenreCombos: suffixes.eventGenreCombos,
} as const;

/**
 * Lista de sufixos do normalizador, em arquivo de configuração e não no
 * algoritmo (§7.2). A versão é gravada em MatchDecision.details para que uma
 * decisão antiga continue explicável depois de a lista mudar.
 */
export const normalizerConfig = {
  version: suffixes.version,
  suffixes: suffixes.suffixes,
  chains: suffixes.chains,
  roomFormats: suffixes.roomFormats,
  /** numeral por extenso → dígito; ver o comentário `_numerais` no JSON */
  numberWords: suffixes.numberWords,
  /** palavras depois das quais um numeral é seguramente número de sequência */
  sequelKeywords: suffixes.sequelKeywords,
} as const;

/** Soma dos pesos — garante que uma edição distraída não quebre a escala 0–1. */
const somaDosPesos = Object.values(matchWeights).reduce((a, b) => a + b, 0);
if (Math.abs(somaDosPesos - 1) > 0.0001) {
  throw new Error(`Os pesos do score precisam somar 1; somam ${somaDosPesos}.`);
}
