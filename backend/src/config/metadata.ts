import { env } from './env';

/** Parâmetros de metadata e notas (§5.2 e §5.3 do contexto). */

export const tmdbConfig = {
  language: 'pt-BR',
  /** §5.2: "elenco principal (primeiros N do cast)" */
  castLimit: 12,
  appendToResponse: 'credits,external_ids,release_dates',
  /** §5.2: cache de metadata de 30 dias */
  cacheDays: 30,
  imagens: {
    base: env.TMDB_IMAGE_BASE,
    poster: 'w500',
    backdrop: 'w1280',
    perfil: 'w185',
    logo: 'w185',
  },
} as const;

export const omdbConfig = {
  /** §5.3: tier grátis, 1.000 requisições/dia */
  dailyQuota: 1000,
  /**
   * §5.3: "diária na primeira semana após a estreia, semanal depois".
   * O `Title.releaseDate` é o que diz em qual dos dois regimes o filme está.
   */
  janelaDeEstreiaDias: 7,
  refreshRecenteDias: 1,
  refreshAntigoDias: 7,
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
