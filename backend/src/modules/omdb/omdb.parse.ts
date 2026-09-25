import type { OmdbSucesso } from './omdb.schemas';
import type { NotasNormalizadas } from './omdb.types';

/**
 * Valores que o OMDb usa para "não tenho este dado". São strings, não null —
 * tratar "N/A" como número dá `NaN` e grava lixo no banco.
 */
const AUSENTES = new Set(['n/a', 'na', '', '-']);

function ausente(valor: string | null | undefined): boolean {
  return valor === null || valor === undefined || AUSENTES.has(valor.trim().toLowerCase());
}

/** "8.4" → 8.4. "N/A", vazio ou fora de 0–10 → null. */
export function notaImdb(valor: string | null | undefined): number | null {
  if (ausente(valor)) return null;
  const n = Number.parseFloat(valor!.trim());
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

/** "92%" → 92. Ausente ou fora de 0–100 → null. */
export function notaRottenTomatoes(valor: string | null | undefined): number | null {
  if (ausente(valor)) return null;
  const casado = /^(\d{1,3})\s*%$/.exec(valor!.trim());
  if (!casado) return null;
  const n = Number.parseInt(casado[1]!, 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Extrai as duas notas que o app mostra (§5.3).
 *
 * Qualquer uma pode faltar, e faltar é normal: filme não lançado não tem nota
 * no IMDb, e muito filme brasileiro nunca é avaliado pelo Rotten Tomatoes.
 * Ausência **nunca** quebra o fluxo — vira `null`.
 */
export function normalizarNotas(corpo: OmdbSucesso): NotasNormalizadas {
  const rt = corpo.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');

  return {
    imdbId: corpo.imdbID,
    title: corpo.Title,
    imdbRating: notaImdb(corpo.imdbRating),
    rtRating: notaRottenTomatoes(rt?.Value),
    consultadoEm: new Date(),
  };
}

/**
 * Com que frequência reconsultar as notas (§5.3): diariamente na primeira
 * semana após a estreia, semanalmente depois.
 */
export function precisaAtualizarNotas(
  releaseDate: Date | null,
  ratingsUpdatedAt: Date | null,
  config: { janelaDeEstreiaDias: number; refreshRecenteDias: number; refreshAntigoDias: number },
  agora = new Date(),
): boolean {
  if (!ratingsUpdatedAt) return true;

  const diasDesdeAConsulta = (agora.getTime() - ratingsUpdatedAt.getTime()) / 86_400_000;

  // sem data de estreia não dá para saber o regime: usa o conservador
  if (!releaseDate) return diasDesdeAConsulta >= config.refreshAntigoDias;

  const diasDesdeAEstreia = (agora.getTime() - releaseDate.getTime()) / 86_400_000;
  const recemEstreado = diasDesdeAEstreia >= 0 && diasDesdeAEstreia <= config.janelaDeEstreiaDias;

  return diasDesdeAConsulta >= (recemEstreado ? config.refreshRecenteDias : config.refreshAntigoDias);
}
