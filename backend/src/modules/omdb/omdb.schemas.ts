import { z } from 'zod';

/**
 * Schemas do OMDb (§5.3).
 *
 * ⚠️ O OMDb responde **HTTP 200 mesmo quando falhou**, sinalizando o erro no
 * corpo com `Response: "False"` + `Error`. Confiar no status HTTP aqui é o
 * caminho mais curto para gravar nota errada — por isso o discriminador é o
 * campo `Response`, não o status.
 *
 * ⚠️ Todo campo de nota pode vir com a string **`"N/A"`**, não `null` e não
 * ausente. Medido: 3 de 10 lançamentos futuros vieram `imdbRating: "N/A"`.
 */

const ratingSchema = z.object({
  Source: z.string(),
  /** "8.4/10", "92%", "79/100" — formato varia por fonte */
  Value: z.string(),
});

export const omdbSucessoSchema = z.object({
  Response: z.literal('True'),
  imdbID: z.string(),
  Title: z.string(),
  Year: z.string().nullish(),
  Type: z.string().nullish(),
  Runtime: z.string().nullish(),
  /** "8.4" ou "N/A" — nunca número */
  imdbRating: z.string().nullish(),
  imdbVotes: z.string().nullish(),
  Metascore: z.string().nullish(),
  /** pode não trazer Rotten Tomatoes nenhum */
  Ratings: z.array(ratingSchema).nullish(),
});

export const omdbFalhaSchema = z.object({
  Response: z.literal('False'),
  Error: z.string(),
});

export const omdbResponseSchema = z.discriminatedUnion('Response', [
  omdbSucessoSchema,
  omdbFalhaSchema,
]);

export type OmdbSucesso = z.infer<typeof omdbSucessoSchema>;
export type OmdbFalha = z.infer<typeof omdbFalhaSchema>;
export type OmdbResponse = z.infer<typeof omdbResponseSchema>;
