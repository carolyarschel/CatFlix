import { normalizerConfig } from '../../config/matching';

/**
 * Normalizador de títulos (§7.2, estágio 3).
 *
 * O algoritmo mora aqui; as LISTAS moram em `config/title-suffixes.json`, com
 * versão. A versão vai para `MatchDecision.details`, para que uma decisão de
 * seis meses atrás continue explicável depois de alguém editar a lista.
 */

const CONFIG = normalizerConfig;

/** minúsculas, sem acento, sem pontuação, espaços colapsados */
export function basico(valor: string): string {
  return valor
    // ORDINAL primeiro: "20º" precisa virar "20o" antes de a pontuação ser
    // varrida, senão vira "20" e fica indistinguível do "3" de
    // "Se Eu Fosse Voce 3" — que tem de ficar.
    .replace(/º/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/°/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Remove um termo quando ele aparece como palavra inteira.
 *
 * O limite de palavra importa de verdade: sem ele, a palavra-chave "opera"
 * casaria dentro de "operacao", e "Operação Fronteira" viraria ópera.
 */
function removerTermo(texto: string, termo: string): string {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return texto.replace(new RegExp(`\\b${escapado}\\b`, 'g'), ' ');
}

/**
 * Converte numeral por extenso em dígito, mas **só em posição segura**:
 * depois de "parte"/"volume"/"capítulo", ou como última palavra do título.
 *
 * Isto existe porque o ingresso escreve "Duna Parte 2" e o TMDB escreve
 * "Duna: Parte Dois" — sem converter, a similaridade cai de 1,00 para 0,65 e
 * o filme não casa. A restrição de posição é o que impede de estragar
 * "Um Sonho de Liberdade" ou "Três Homens em Conflito".
 */
export function normalizarNumerais(texto: string): string {
  const palavras = texto.split(' ');
  const mapa = CONFIG.numberWords as Record<string, string>;

  return palavras
    .map((palavra, indice) => {
      const digito = mapa[palavra];
      if (!digito) return palavra;

      const anterior = indice > 0 ? palavras[indice - 1]! : '';
      const depoisDeSequencia = (CONFIG.sequelKeywords as readonly string[]).includes(anterior);
      const ultimaPalavra = indice === palavras.length - 1;

      return depoisDeSequencia || ultimaPalavra ? digito : palavra;
    })
    .join(' ');
}

/**
 * Tirar um termo do meio deixa preposição pendurada: "Akira (Remasterizado Em
 * 4K)" virava "akira em 4k". Conectivo sozinho na ponta não diz nada sobre a
 * obra e só atrapalha a similaridade.
 */
const CONECTIVOS = new Set(['em', 'de', 'do', 'da', 'dos', 'das', 'com', 'no', 'na', 'e', 'o', 'a', 'in', 'of']);

/**
 * Ordinal solto na ponta, como o "20o" que sobra de "Carros (20º
 * Aniversário)" depois de remover "aniversario". Só ORDINAL (20o, 25a): o
 * número puro fica, porque "Se Eu Fosse Você 3" precisa do 3.
 */
const ORDINAL_SOLTO = /^\d+[oa]$/;

function limparConectivosOrfaos(texto: string): string {
  const palavras = texto.split(' ').filter(Boolean);

  // só na ponta final: "O Brutalista" precisa manter o "o" inicial
  while (
    palavras.length > 1 &&
    (CONECTIVOS.has(palavras[palavras.length - 1]!) || ORDINAL_SOLTO.test(palavras[palavras.length - 1]!))
  ) {
    palavras.pop();
  }

  return palavras.join(' ');
}

export interface TituloNormalizado {
  /** forma canônica: é ela que vai para `Title.normalizedTitle` e para o pg_trgm */
  normalizado: string;
  /** mesma coisa sem espaço nenhum — pega "Divertidamente" × "Divertida Mente" */
  semEspacos: string;
  /** o que foi removido, para o rastro em MatchDecision */
  removidos: string[];
  versaoDaConfig: string;
}

/**
 * Tira do título tudo que descreve a SESSÃO e não a OBRA: sufixos de áudio,
 * tipo de sala, nome de rede, "Reexibição", "Pré-estreia", "Sessão Especial".
 */
export function normalizarTitulo(bruto: string): TituloNormalizado {
  let texto = basico(bruto);
  const removidos: string[] = [];

  // do mais longo para o mais curto: "reexibicao especial" antes de "reexibicao",
  // senão a remoção curta deixa um pedaço órfão para trás
  const termos = [...CONFIG.suffixes, ...CONFIG.roomFormats, ...CONFIG.chains]
    .map((t) => basico(t))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const termo of termos) {
    const antes = texto;
    texto = removerTermo(texto, termo);
    if (texto !== antes) removidos.push(termo);
  }

  // sobras de pontuação viraram espaço lá no básico; recolhe
  texto = texto.replace(/\s+/g, ' ').trim();
  texto = limparConectivosOrfaos(texto);
  texto = normalizarNumerais(texto);

  return {
    normalizado: texto,
    semEspacos: texto.replace(/\s/g, ''),
    removidos,
    versaoDaConfig: CONFIG.version,
  };
}
