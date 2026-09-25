import { matchTolerances, matchWeights } from '../../config/matching';
import { basico } from './matching.normalizer';
import { similaridade } from './matching.trigram';

/**
 * Score composto do §7.2: título 0,5 · duração 0,2 · ano 0,2 · crédito 0,1.
 *
 * ⚠️ **Decisão de projeto que o contexto não cobre: componente incomparável.**
 *
 * O ingresso quase nunca manda diretor e elenco numa reexibição, e às vezes
 * não manda duração nem ano. Se um componente ausente contasse zero, o teto do
 * score cairia: sem crédito, o máximo possível seria 0,9 — **abaixo do limiar
 * de aceitação automática de 0,92**. Nenhuma reexibição jamais casaria sozinha,
 * e a fila de revisão encheria de casos óbvios.
 *
 * Então: componente que não dá para comparar é **descartado, e o peso dele é
 * redistribuído** proporcionalmente entre os que sobraram. O score continua
 * numa escala 0–1 honesta, e os pesos relativos do §7.2 são preservados.
 *
 * O `MatchDecision` grava quais componentes entraram, para a decisão continuar
 * explicável depois.
 */

export interface AlvoDoScore {
  /** título normalizado (com e sem espaço) do lado do ingresso */
  normalizado: string;
  semEspacos: string;
  year: number | null;
  runtimeMinutes: number | null;
  directorNames: string[];
  castNames: string[];
}

export interface CandidatoDoScore {
  normalizado: string;
  semEspacos: string;
  /** data de estreia do candidato; ausente ou futura = ano é estimativa */
  releaseDate?: Date | null;
  /** ano e data da estreia nos cinemas BRASILEIROS, quando o TMDB conhece */
  yearBr?: number | null;
  releaseDateBr?: Date | null;
  /** título original normalizado, quando houver — dá uma segunda chance ao trigrama */
  normalizadoOriginal?: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  directorNames?: string[];
  castNames?: string[];
}

export interface ComponenteDoScore {
  valor: number;
  peso: number;
  detalhe: string;
}

export interface ResultadoDoScore {
  total: number;
  componentes: {
    title?: ComponenteDoScore;
    runtime?: ComponenteDoScore;
    year?: ComponenteDoScore;
    credits?: ComponenteDoScore;
  };
  /** componentes que não deram para comparar e tiveram o peso redistribuído */
  ignorados: string[];
}

/**
 * Similaridade de título: o melhor entre comparar com espaço, sem espaço, e
 * contra o título original do candidato.
 *
 * O "sem espaço" não é firula: "Divertidamente 2" × "Divertida Mente 2" dá
 * 0,750 com espaço e 1,000 sem. Título brasileiro varia a separação assim o
 * tempo todo.
 */
export function similaridadeDeTitulo(alvo: AlvoDoScore, candidato: CandidatoDoScore): number {
  const opcoes = [
    similaridade(alvo.normalizado, candidato.normalizado),
    similaridade(alvo.semEspacos, candidato.semEspacos),
  ];

  if (candidato.normalizadoOriginal) {
    opcoes.push(similaridade(alvo.normalizado, candidato.normalizadoOriginal));
    opcoes.push(similaridade(alvo.semEspacos, candidato.normalizadoOriginal.replace(/\s/g, '')));
  }

  return Math.max(...opcoes);
}

/** Igual até a tolerância do match forte; depois cai linearmente até 20 min. */
export function pontuarDuracao(a: number, b: number): number {
  const diferenca = Math.abs(a - b);
  if (diferenca <= matchTolerances.runtimeSlackMinutes) return 1;
  if (diferenca >= 20) return 0;
  return 1 - (diferenca - matchTolerances.runtimeSlackMinutes) / (20 - matchTolerances.runtimeSlackMinutes);
}

/**
 * Ano exato vale tudo; um ano de diferença vale metade.
 *
 * A diferença de um ano é comum e legítima — estreia lá fora num ano e no
 * Brasil no seguinte — mas é exatamente o caso que o §7.4 manda **não** aceitar
 * sozinho: *O Brutalista* é 2024 no TMDB e 2025 no cartaz brasileiro. Meio
 * ponto puxa o total para a faixa de revisão, que é onde ele deve parar.
 */
export function pontuarAno(a: number, b: number): number {
  const diferenca = Math.abs(a - b);
  if (diferenca === 0) return 1;
  if (diferenca === 1) return 0.5;
  if (diferenca === 2) return 0.2;
  return 0;
}

/** Proporção de nomes do ingresso que aparecem nos créditos do candidato. */
export function pontuarCreditos(
  alvo: { directorNames: string[]; castNames: string[] },
  candidato: { directorNames?: string[]; castNames?: string[] },
): number | null {
  const doAlvo = [...alvo.directorNames, ...alvo.castNames].map(basico).filter(Boolean);
  const doCandidato = [...(candidato.directorNames ?? []), ...(candidato.castNames ?? [])]
    .map(basico)
    .filter(Boolean);

  // incomparável: o peso vai ser redistribuído
  if (doAlvo.length === 0 || doCandidato.length === 0) return null;

  const encontrados = doAlvo.filter((nome) => doCandidato.includes(nome)).length;
  return encontrados / doAlvo.length;
}

/**
 * O ano só é fato para filme que já estreou em algum lugar. Sem data nenhuma,
 * ou só com data futura, é palpite de calendário de lançamento.
 */
function anoEhFato(candidato: CandidatoDoScore, agora = new Date()): boolean {
  const datas = [candidato.releaseDate, candidato.releaseDateBr];
  return datas.some((d) => d instanceof Date && d.getTime() <= agora.getTime());
}

/**
 * Melhor ano do candidato contra o ano do evento.
 *
 * Um filme tem mais de um "ano de lançamento" legítimo, e o campo do ingresso
 * é ambíguo sobre qual deles publica. Medido:
 *
 *   O Brutalista    ingresso 2025 · global 2024 · **Brasil 2025**
 *   Lago dos Ossos  ingresso 2024 · global 2025 · Brasil 2026
 *
 * Trocar o global pelo brasileiro consertaria o primeiro e PIORARIA o segundo.
 * Comparar com os dois e ficar com o melhor conserta um e nunca piora o outro:
 * casar com qualquer data de estreia real do filme é evidência legítima.
 */
export function melhorPontuacaoDeAno(
  anoDoEvento: number,
  candidato: CandidatoDoScore,
): { valor: number; detalhe: string } | null {
  const opcoes: Array<{ ano: number; origem: string }> = [];
  if (candidato.year !== null && candidato.year !== undefined) {
    opcoes.push({ ano: candidato.year, origem: 'global' });
  }
  if (candidato.yearBr !== null && candidato.yearBr !== undefined) {
    opcoes.push({ ano: candidato.yearBr, origem: 'Brasil' });
  }
  if (opcoes.length === 0) return null;

  const melhor = opcoes
    .map((o) => ({ ...o, valor: pontuarAno(anoDoEvento, o.ano) }))
    .reduce((a, b) => (b.valor > a.valor ? b : a));

  return {
    valor: melhor.valor,
    detalhe: `${anoDoEvento} × ${melhor.ano} (${melhor.origem})`,
  };
}

export function calcularScore(alvo: AlvoDoScore, candidato: CandidatoDoScore): ResultadoDoScore {
  const componentes: ResultadoDoScore['componentes'] = {};
  const ignorados: string[] = [];

  // título é o único componente sempre comparável — sem título não há evento
  const valorTitulo = similaridadeDeTitulo(alvo, candidato);
  componentes.title = {
    valor: valorTitulo,
    peso: matchWeights.title,
    detalhe: `"${alvo.normalizado}" × "${candidato.normalizado}"`,
  };

  if (alvo.runtimeMinutes !== null && candidato.runtimeMinutes !== null) {
    componentes.runtime = {
      valor: pontuarDuracao(alvo.runtimeMinutes, candidato.runtimeMinutes),
      peso: matchWeights.runtime,
      detalhe: `${alvo.runtimeMinutes} min × ${candidato.runtimeMinutes} min`,
    };
  } else {
    ignorados.push('runtime');
  }

  const ano = alvo.year === null ? null : melhorPontuacaoDeAno(alvo.year, candidato);

  if (ano === null) {
    ignorados.push('year');
  } else if (!anoEhFato(candidato)) {
    // ⚠️ Componente presente mas NÃO INFORMATIVO.
    //
    // Para um filme que ainda não estreou, a data é uma estimativa: o
    // ingresso anuncia 2026, o TMDB diz 2028, e os dois estão "certos". Medido
    // na fila real: "Os Incríveis 3", "Star Wars: Starfighter" e "Bluey: O
    // Filme" tinham título 1,00 E elenco 1,00, e caíam para 0,750 só por causa
    // do ano — indo para revisão sem necessidade nenhuma.
    //
    // Descartar é diferente de pontuar zero: zero é evidência CONTRA, e aqui
    // não há evidência nenhuma.
    ignorados.push('year:estimativa');
  } else {
    componentes.year = {
      valor: ano.valor,
      peso: matchWeights.year,
      detalhe: ano.detalhe,
    };
  }

  const valorCreditos = pontuarCreditos(alvo, candidato);
  if (valorCreditos !== null) {
    componentes.credits = {
      valor: valorCreditos,
      peso: matchWeights.credits,
      detalhe: `${alvo.directorNames.length + alvo.castNames.length} nome(s) do ingresso`,
    };
  } else {
    ignorados.push('credits');
  }

  // redistribuição: divide pela soma dos pesos que de fato entraram
  const presentes = Object.values(componentes);
  const somaDosPesos = presentes.reduce((s, c) => s + c.peso, 0);
  const total = somaDosPesos === 0 ? 0 : presentes.reduce((s, c) => s + c.valor * c.peso, 0) / somaDosPesos;

  return { total, componentes, ignorados };
}
