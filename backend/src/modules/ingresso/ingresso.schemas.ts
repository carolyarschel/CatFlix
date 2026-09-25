import { z } from 'zod';

/**
 * Schemas do ingresso.com — escritos contra o CONTRATO.md (observação real),
 * NÃO contra o OpenAPI publicado, que diverge em pelo menos cinco pontos.
 *
 * Princípio: **estrito no que usamos, permissivo no que não usamos.**
 * Campo que alimenta o catálogo é obrigatório e tipado — se sumir ou mudar de
 * tipo, o canary de contrato dispara e o sync NÃO atualiza nada (§7.1).
 * Campo que só passeia pelo payload é `.nullish()` — mudança ali não pode
 * derrubar a madrugada da Carol.
 */

/**
 * `localDate` vem com offset UTC: "2026-09-22T13:10:00-03:00".
 * O offset é o que nos deixa gravar `timestamptz` sem aplicar fuso à mão —
 * se ele sumir, o horário de TODAS as sessões silenciosamente escorrega.
 * Por isso isto é uma guarda de contrato, não um detalhe.
 */
const dataComOffset = z
  .string()
  .refine((valor) => !Number.isNaN(Date.parse(valor)), 'data não parseável')
  .refine(
    (valor) => /(?:[+-]\d{2}:?\d{2}|Z)$/.test(valor),
    'localDate precisa trazer o offset UTC (ex.: 2026-09-22T13:10:00-03:00)',
  );

// ── cidades e fusos ──────────────────────────────────────────

export const citySchema = z.object({
  id: z.string(),
  name: z.string(),
  uf: z.string().nullish(),
  state: z.string().nullish(),
  urlKey: z.string().nullish(),
  /** usado em Cinema.timezone; a ausência cai no padrão da cidade */
  timeZone: z.string().nullish(),
});

export const stateSchema = z.object({
  name: z.string().nullish(),
  uf: z.string().nullish(),
  cities: z.array(citySchema).nullish(),
});

/** GET /v0/states devolve um ARRAY de estados. */
export const statesResponseSchema = z.array(stateSchema);

// ── envelope das listas ──────────────────────────────────────

/**
 * ⚠️ `count` é o tamanho DESTA página, não o total do catálogo — não existe
 * campo de total. Ver CONTRATO.md §4.4.
 */
function envelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    count: z.number().int().nonnegative(),
  });
}

// ── cinemas ──────────────────────────────────────────────────

export const theaterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** rede → Cinema.chain */
  corporation: z.string().nullish(),
  corporationId: z.string().nullish(),
  address: z.string().nullish(),
  number: z.string().nullish(),
  neighborhood: z.string().nullish(),
  cityId: z.string().nullish(),
  cityName: z.string().nullish(),
  uf: z.string().nullish(),
  urlKey: z.string().nullish(),
  totalRooms: z.number().int().nullish(),
  enabled: z.boolean().nullish(),
});

export const theatersResponseSchema = envelope(theaterSchema);

// ── sessões ──────────────────────────────────────────────────

/**
 * A classificação áudio × formato de sala sai do `id`, não do nome
 * (CONTRATO.md §6): `id === 0` é áudio, `id > 0` é formato (máscara de bits).
 * Por isso `id` é obrigatório aqui — é a regra inteira.
 */
export const sessionTypeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  alias: z.string().nullish(),
  display: z.boolean().nullish(),
});

export const dummyDateSchema = z.object({
  localDate: dataComOffset,
  isToday: z.boolean().nullish(),
  dayOfWeek: z.string().nullish(),
  dayAndMonth: z.string().nullish(),
  hour: z.string().nullish(),
  year: z.string().nullish(),
});

export const sessionSchema = z.object({
  /** chave natural do sync; 0 ausências em 1.123 sessões amostradas */
  id: z.string(),
  room: z.string().nullish(),
  /** versão achatada de `types`, sem os ids — preferimos `types` */
  type: z.array(z.string()).nullish(),
  types: z.array(sessionTypeSchema).nullish(),
  time: z.string().nullish(),
  date: dummyDateSchema,
  realDate: dummyDateSchema.nullish(),
  /** vira Session.purchaseUrl */
  siteURL: z.string().nullish(),
  price: z.number().nullish(),
  enabled: z.boolean().nullish(),
  blockMessage: z.string().nullish(),
});

export const roomSchema = z.object({
  name: z.string().nullish(),
  /** veio `null` em toda a amostra; ignorado no parser */
  type: z.array(z.string()).nullish(),
  sessions: z.array(sessionSchema).nullish(),
});

export const showtimeMovieSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().nullish(),
  /** sempre "Filme", inclusive em show e ópera — inútil para triagem (§5) */
  type: z.string().nullish(),
  /** string de minutos: "166" */
  duration: z.string().nullish(),
  releaseYear: z.number().int().nullish(),
  /** "Sem Distribuidor" é literal, nunca nulo (CONTRATO.md §5) */
  distributor: z.string().nullish(),
  inPreSale: z.boolean().nullish(),
  isReexhibition: z.boolean().nullish(),
  genres: z.array(z.string()).nullish(),
  /** link do card para a página do filme (§1 do contexto) */
  siteURL: z.string().nullish(),
  images: z.array(z.object({ url: z.string().nullish(), type: z.string().nullish() })).nullish(),
  contentRating: z.string().nullish(),
  rooms: z.array(roomSchema).nullish(),
});

export const showtimeDaySchema = z.object({
  date: z.string(),
  dateFormatted: z.string().nullish(),
  dayOfWeek: z.string().nullish(),
  isToday: z.boolean().nullish(),
  movies: z.array(showtimeMovieSchema).nullish(),
});

/**
 * ⚠️ O OpenAPI declara UM objeto. A API devolve um ARRAY, um item por dia
 * (29 a 34 dias na amostra). Ver CONTRATO.md §4.3.
 */
export const sessionsResponseSchema = z.array(showtimeDaySchema);

// ── eventos (listas por cidade) ──────────────────────────────

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().nullish(),
  type: z.string().nullish(),
  duration: z.string().nullish(),
  releaseYear: z.number().int().nullish(),
  distributor: z.string().nullish(),
  synopsis: z.string().nullish(),
  /** strings, não listas; alimentam o componente de crédito do score */
  cast: z.string().nullish(),
  director: z.string().nullish(),
  directors: z.string().nullish(),
  countryOrigin: z.string().nullish(),
  contentRating: z.string().nullish(),
  genres: z.array(z.string()).nullish(),
  images: z.array(z.object({ url: z.string().nullish(), type: z.string().nullish() })).nullish(),
  siteURL: z.string().nullish(),
  urlKey: z.string().nullish(),
  inPreSale: z.boolean().nullish(),
  isReexhibition: z.boolean().nullish(),
  isComingSoon: z.boolean().nullish(),
  isPlaying: z.boolean().nullish(),
  premiereDate: dummyDateSchema.partial({ localDate: true }).nullish(),
});

export const eventsResponseSchema = envelope(eventSchema);

// ── tipos inferidos ──────────────────────────────────────────

export type RawCity = z.infer<typeof citySchema>;
export type RawState = z.infer<typeof stateSchema>;
export type RawTheater = z.infer<typeof theaterSchema>;
export type RawSessionType = z.infer<typeof sessionTypeSchema>;
export type RawSession = z.infer<typeof sessionSchema>;
export type RawRoom = z.infer<typeof roomSchema>;
export type RawShowtimeMovie = z.infer<typeof showtimeMovieSchema>;
export type RawShowtimeDay = z.infer<typeof showtimeDaySchema>;
export type RawEvent = z.infer<typeof eventSchema>;
