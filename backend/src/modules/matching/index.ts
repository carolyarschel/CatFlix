export { decidir } from './matching.engine';
export { decidirERegistrar, taxaDeAutoMatch } from './matching.service';
export type { OpcoesDoMatching } from './matching.service';
export { FontesDeProducao } from './matching.sources';
export { basico, normalizarNumerais, normalizarTitulo } from './matching.normalizer';
export type { TituloNormalizado } from './matching.normalizer';
export { triar, limiarDeSuspeita } from './matching.triage';
export type { EntradaDaTriagem, ResultadoTriagem, SinalDeTriagem } from './matching.triage';
export { calcularScore, similaridadeDeTitulo, pontuarAno, pontuarCreditos, pontuarDuracao } from './matching.score';
export type { ResultadoDoScore } from './matching.score';
export { similaridade, trigramas } from './matching.trigram';
export type {
  CandidatoAvaliado,
  DecisaoDeMatching,
  EventoParaMatching,
  FontesDeMatching,
  TituloExistente,
} from './matching.types';
