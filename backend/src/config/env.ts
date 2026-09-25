import 'dotenv/config';
import { z } from 'zod';

/**
 * Toda variável de ambiente passa por aqui. Nenhum módulo lê `process.env`
 * diretamente — assim uma variável faltando aparece no boot, não no meio de um job.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // banco
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

    // ingresso.com (API interna — §5.1)
    INGRESSO_BASE_URL: z.string().default('https://api-content.ingresso.com/v0'),
    INGRESSO_CITY_ID: z.string().optional(),
    /**
     * Parâmetro obrigatório de caminho em todo endpoint de conteúdo, e não
     * documentado no OpenAPI. O valor muda materialmente o resultado — ver
     * modules/ingresso/CONTRATO.md §2. `www` devolve o catálogo completo de
     * todas as redes; `ingresso` devolve zero cinemas; `home` devolve UTF-16.
     */
    INGRESSO_PARTNERSHIP: z.string().default('www'),
    /**
     * Lista branca de cinemas, por id do ingresso, separada por vírgula.
     * Vazia = todos os cinemas da cidade.
     *
     * O contexto.md não prevê filtro de cinema (fala em "cada cinema" da
     * cidade); isto é um acréscimo pedido depois. Fica em configuração para
     * que mudar de shopping não exija mexer em código.
     */
    INGRESSO_THEATER_IDS: z
      .string()
      .default('')
      .transform((valor) =>
        valor
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    /**
     * User-Agent de TODAS as chamadas externas (ingresso, TMDB e OMDb).
     * O nome vem da §16 do contexto, mas o uso é geral.
     *
     * ⚠️ **Só ASCII.** Valor de cabeçalho HTTP não pode ter caractere não-ASCII
     * (RFC 9110 §5.5). Um acento aqui faz o WAF do OMDb devolver 403 com página
     * HTML em 100% das chamadas — medido — e há indício de que provoque 400
     * intermitente no ingresso. É um erro que não se anuncia: o cabeçalho sai,
     * a requisição parece normal, e o bloqueio parece problema da API.
     */
    INGRESSO_USER_AGENT: z
      .string()
      .default('AppFilmes/0.1 (uso pessoal; contato pelo responsavel da instancia)')
      .refine(
        (valor) => /^[\x20-\x7e]*$/.test(valor),
        'INGRESSO_USER_AGENT precisa ser só ASCII imprimível: acento em cabeçalho HTTP faz o OMDb bloquear com 403',
      ),

    // TMDB (§5.2)
    TMDB_BASE_URL: z.string().default('https://api.themoviedb.org/3'),
    TMDB_IMAGE_BASE: z.string().default('https://image.tmdb.org/t/p'),
    TMDB_API_KEY: z.string().optional(),

    // OMDb (§5.3)
    OMDB_BASE_URL: z.string().default('https://www.omdbapi.com'),
    OMDB_API_KEY: z.string().optional(),

    // canaries / alertas (§8)
    NOTIFIER_WEBHOOK_URL: z.string().optional(),

    /**
     * Web Push do PWA (§3). Gere o par com `npx web-push generate-vapid-keys`.
     * A pública vai para o navegador; a privada nunca sai do backend.
     *
     * Sem as duas, o canal de push fica desligado e o log segue como piso —
     * o app sobe normalmente.
     */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

    /**
     * Autenticação dos dois perfis (§3, resolvido em 23/09/2026: tela de login
     * com seletor de perfil e senha vinda do `.env`).
     *
     * Uma senha por perfil. `AUTH_PASSWORD` serve de padrão para os dois, para
     * o caso de a Carol querer uma senha só — a específica, quando existe,
     * ganha da geral.
     *
     * ⚠️ **Sem senha nenhuma configurada o login não sobe.** Não há padrão de
     * fábrica de propósito: uma senha padrão que ninguém troca é pior do que
     * não ter senha, porque dá a impressão de proteção.
     */
    AUTH_PASSWORD: z.string().optional(),
    AUTH_PASSWORD_CATFLIX: z.string().optional(),
    AUTH_PASSWORD_HBURSO: z.string().optional(),
    /**
     * Segredo que assina o cookie de sessão. Trocar o valor derruba todas as
     * sessões abertas — que é exatamente o que se quer se alguém perder o
     * celular.
     */
    AUTH_SECRET: z.string().optional(),
    /** Quantos dias a sessão dura. É um app de casal no celular, não um banco. */
    AUTH_SESSION_DAYS: z.coerce.number().int().positive().max(365).default(30),

    // matching (§7.2) — limiares em configuração, nunca hardcoded
    MATCH_AUTO_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
    MATCH_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),

    // política de acesso HTTP (§5.1): concorrência máxima de 4, backoff, respeitar 429
    HTTP_MAX_CONCURRENCY: z.coerce.number().int().positive().max(8).default(4),
    HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    HTTP_BASE_DELAY_MS: z.coerce.number().int().positive().default(500),

    // modo degradado (§8): a partir de quantas horas de cache o app avisa "dados de X horas atrás"
    DEGRADED_AFTER_HOURS: z.coerce.number().positive().default(12),

    /**
     * Liga o agendador (§9). Vazio = ligado em produção, desligado em
     * desenvolvimento — senão o `npm run dev` bate nas APIs externas três
     * vezes por dia enquanto se mexe no código.
     *
     * Não use `z.coerce.boolean()`: ele transforma a string "false" em `true`,
     * porque qualquer string não vazia é verdadeira em JavaScript.
     *
     * E `z.enum([...]).optional()` também não serve sozinho: uma variável
     * declarada e VAZIA no `.env` (`CRON_ENABLED=`) chega como `""`, que não
     * está no enum e derruba o boot. Vazio tem de significar "não informado".
     */
    CRON_ENABLED: z
      .string()
      .optional()
      .transform((valor) => {
        const limpo = valor?.trim().toLowerCase();
        return limpo === undefined || limpo === '' ? undefined : limpo;
      })
      .refine(
        (valor) => valor === undefined || ['true', 'false', '1', '0'].includes(valor),
        'CRON_ENABLED aceita true, false, 1, 0 ou vazio',
      ),
  })
  .refine((e) => e.MATCH_REVIEW_THRESHOLD < e.MATCH_AUTO_THRESHOLD, {
    message: 'MATCH_REVIEW_THRESHOLD precisa ser menor que MATCH_AUTO_THRESHOLD',
    path: ['MATCH_REVIEW_THRESHOLD'],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${detalhes}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Agendador: explícito no ambiente, ou o padrão por ambiente. */
export const cronHabilitado =
  env.CRON_ENABLED === undefined ? isProduction : env.CRON_ENABLED === 'true' || env.CRON_ENABLED === '1';

/**
 * Chaves que o esqueleto tolera vazias (os módulos que dependem delas ainda não
 * existem), mas que precisam estar presentes antes dos jobs rodarem de verdade.
 * O boot avisa em vez de falhar em silêncio.
 */
export function missingOptionalKeys(): string[] {
  const faltando: string[] = [];
  if (!env.TMDB_API_KEY) faltando.push('TMDB_API_KEY');
  if (!env.OMDB_API_KEY) faltando.push('OMDB_API_KEY');
  if (!env.INGRESSO_CITY_ID) faltando.push('INGRESSO_CITY_ID');
  if (!env.NOTIFIER_WEBHOOK_URL) faltando.push('NOTIFIER_WEBHOOK_URL');
  return faltando;
}

/**
 * Senha de um perfil: a específica, ou a geral. `null` = perfil sem senha
 * configurada, que **não pode entrar**.
 */
export function senhaDoPerfil(perfil: string): string | null {
  const especificas: Record<string, string | undefined> = {
    catflix: env.AUTH_PASSWORD_CATFLIX,
    hburso: env.AUTH_PASSWORD_HBURSO,
  };

  return especificas[perfil] || env.AUTH_PASSWORD || null;
}

/**
 * O login está configurável? Em produção, **não subir sem isto** é a decisão
 * certa: um app aberto na internet sem senha nenhuma é pior que um app fora do
 * ar. Em desenvolvimento, só avisa.
 */
export function authConfigurada(): boolean {
  return Boolean(env.AUTH_SECRET && (senhaDoPerfil('catflix') || senhaDoPerfil('hburso')));
}

/**
 * Usada pelos módulos de fonte: falha alto e claro na hora de usar a chave,
 * em vez de mandar uma requisição sem credencial e receber um 401 confuso.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`A variável de ambiente ${String(key)} é necessária para esta operação.`);
  }
  return value as NonNullable<Env[K]>;
}
