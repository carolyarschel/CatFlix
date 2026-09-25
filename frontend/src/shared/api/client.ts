/**
 * Cliente HTTP do frontend. Fala SÓ com o nosso backend, nunca com o
 * ingresso.com, o TMDB ou o OMDb (§5.1).
 */

const BASE_URL = '/api';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
}

function montarQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null) continue;
    // filtros de tag chegam como lista: tag=imax&tag=dublado
    if (Array.isArray(valor)) {
      for (const item of valor) params.append(chave, item);
    } else {
      params.set(chave, String(valor));
    }
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
}

/**
 * Ouvintes de "a sessão caiu".
 *
 * O cookie de sessão é `httpOnly`: o JavaScript não consegue olhar para ele e
 * perguntar se ainda vale. A única forma de descobrir é levar um 401 — então
 * quem levar avisa todo mundo, e o app volta para a tela de login em vez de
 * ficar girando.
 */
const ouvintesDeSessao = new Set<() => void>();

export function aoPerderSessao(ouvinte: () => void): () => void {
  ouvintesDeSessao.add(ouvinte);
  return () => ouvintesDeSessao.delete(ouvinte);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}${montarQuery(options.query)}`;

  const resposta = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    // o cookie de sessão viaja aqui; mesma origem, então o padrão já bastaria,
    // mas explícito é documentação
    credentials: 'same-origin',
  });

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  const dados: unknown = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    // a rota pública de sessão devolve 401 quando a senha não confere; isso é
    // resposta de login, não sessão perdida, e não pode derrubar ninguém
    if (resposta.status === 401 && !path.startsWith('/auth/')) {
      for (const ouvinte of ouvintesDeSessao) ouvinte();
    }

    const corpo = dados as Partial<ApiErrorBody> | null;
    throw new ApiError(
      corpo?.error?.message ?? `Falha na requisição (${resposta.status})`,
      resposta.status,
      corpo?.error?.code ?? 'UNKNOWN',
      corpo?.error?.details,
    );
  }

  return dados as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
