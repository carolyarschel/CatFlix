import { env } from './env';

/** Parâmetros de metadata e notas (§5.2 e §5.3 do contexto). */

export const tmdbConfig = {
  language: env.TMDB_LANGUAGE,
  /** sinopse vazia no idioma principal → pede a deste (cineon-expansao §5.2) */
  fallbackLanguage: env.TMDB_FALLBACK_LANGUAGE,
  /** país das datas de estreia (e, depois, dos provedores de streaming) */
  region: env.TMDB_REGION,
  /** §5.2: "elenco principal (primeiros N do cast)" */
  castLimit: 12,
  // `watch/providers`: onde assistir (cineon-expansao §6), no mesmo pedido
  appendToResponse: 'credits,external_ids,release_dates,watch/providers',
  /**
   * Cadência do refresh de metadata (cineon-expansao §5.3), no lugar dos 30
   * dias do contexto original — pensados para o cinema, e desperdiçados num
   * acervo de centenas de filmes antigos.
   *
   * Lançamento (ainda não estreou, ou estreou há até 90 dias): a cada 7 dias,
   * porque elenco, sinopse e data mudam muito nessa fase. O resto: a cada 90.
   */
  refresh: {
    janelaDeLancamentoDias: 90,
    lancamentoDias: 7,
    acervoDias: 90,
  },
  /**
   * Teto por execução do job. Uma importação do histórico (§11) vence de uma
   * vez centenas de filmes; sem teto, o job das 04h faria ~2 pedidos por filme
   * de uma vez só. O que sobra fica para o dia seguinte, os mais velhos antes.
   */
  maxPorExecucao: 300,
  imagens: {
    base: env.TMDB_IMAGE_BASE,
    poster: 'w500',
    backdrop: 'w1280',
    perfil: 'w185',
    logo: 'w185',
  },
} as const;

export const omdbConfig = {
  /**
   * Chamadas por 24 h (`OMDB_DAILY_QUOTA`, padrão 900). O tier grátis dá
   * 1.000; a folga cobre consultas fora do job e erro de contagem.
   */
  dailyQuota: env.OMDB_DAILY_QUOTA,
  /**
   * §5.3: "diária na primeira semana após a estreia, semanal depois".
   * O `Title.releaseDate` é o que diz em qual dos dois regimes o filme está.
   */
  janelaDeEstreiaDias: 7,
  refreshRecenteDias: 1,
  refreshAntigoDias: 7,
  /**
   * Acervo (cineon-expansao §5.3): filme com mais de 1 ano não muda de nota
   * de uma semana para a outra — mensal basta, e poupa a cota para o cinema.
   */
  acervoIdadeMinimaDias: 365,
  refreshAcervoDias: 30,
} as const;

/** Monta a URL absoluta de uma imagem do TMDB a partir do caminho relativo. */
export function urlDeImagemTmdb(
  caminho: string | null | undefined,
  tamanho: keyof typeof tmdbConfig.imagens = 'poster',
): string | null {
  if (!caminho) return null;
  const dimensao = tmdbConfig.imagens[tamanho];
  if (typeof dimensao !== 'string' || dimensao === tmdbConfig.imagens.base) return null;
  return `${tmdbConfig.imagens.base}/${dimensao}${caminho}`;
}
