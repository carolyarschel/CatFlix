export interface NotasNormalizadas {
  imdbId: string;
  title: string;
  /** 0–10, ou null: filme sem nota é o caso normal, não o excepcional */
  imdbRating: number | null;
  /** 0–100, ou null: muito filme nunca é avaliado pelo Rotten Tomatoes */
  rtRating: number | null;
  consultadoEm: Date;
}

/**
 * O OMDb tem três desfechos, e confundi-los é como se grava nota errada:
 *   - `notas`        → deu certo
 *   - `nao_encontrado` → o imdb_id não existe lá. NÃO é erro: o filme segue
 *                        no catálogo, só sem nota (§5.3)
 *   - erro lançado   → chave inválida ou API fora, que é problema de verdade
 */
export type ResultadoOmdb =
  | { tipo: 'notas'; notas: NotasNormalizadas; rawPayloadId: string }
  | { tipo: 'nao_encontrado'; motivo: string; rawPayloadId: string };
