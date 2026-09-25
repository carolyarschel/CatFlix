import { env } from '../../config/env';
import { ExternalApiError } from '../errors';
import { logger } from '../logger';
import { redigirParametros, redigirUrl } from '../redact';
import { Semaphore } from './semaphore';

/**
 * Cliente HTTP compartilhado pelos módulos de fonte (ingresso, tmdb, omdb).
 *
 * Regras que ele implementa (§5.1):
 *   - User-Agent honesto e fixo
 *   - concorrência máxima configurável (4 no ingresso)
 *   - backoff exponencial com jitter
 *   - respeita 429 e o cabeçalho Retry-After
 *   - NUNCA é chamado a partir do navegador: isto roda só no backend
 *
 * Ele devolve o corpo CRU (texto) junto com o status. Quem chama grava o
 * `RawPayload` antes de qualquer parsing (§7.1) — por isso o cliente não faz
 * `JSON.parse` por conta própria nem valida nada.
 */

export type TransportOutcome = 'ok' | 'http_error' | 'rate_limited' | 'forbidden' | 'network_error' | 'timeout';

export interface TransportEvent {
  source: string;
  endpoint: string;
  url: string;
  outcome: TransportOutcome;
  httpStatus?: number;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  /** corpo cru, exatamente como veio: é isto que vai para RawPayload */
  bodyText: string;
  url: string;
  endpoint: string;
  params: Record<string, string>;
  attempts: number;
  durationMs: number;
  /** `JSON.parse` do corpo. Lança se não for JSON — o chamador decide quando chamar. */
  json<T = unknown>(): T;
}

export interface HttpClientOptions {
  /** nome da fonte, usado em log e nos canaries: 'ingresso' | 'tmdb' | 'omdb' */
  source: string;
  baseUrl: string;
  userAgent?: string;
  maxConcurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  defaultHeaders?: Record<string, string>;
  /**
   * Trata `400` com corpo VAZIO como falha transitória, digna de nova tentativa.
   *
   * Existe por causa do ingresso.com, que sinaliza throttle com `400` e corpo
   * vazio em vez de `429` (observado: a mesma URL devolve 400 por alguns
   * minutos e volta a 200 sozinha). Fica desligado por padrão — num serviço
   * que se comporta, `400` é erro do pedido e insistir não ajuda.
   */
  retryEmpty400?: boolean;
  /** gancho para o módulo de canaries observar o transporte sem que a fonte o conheça */
  onTransportEvent?: (evento: TransportEvent) => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** sobrescreve o número de tentativas só desta chamada */
  maxRetries?: number;
}

const STATUS_QUE_MERECEM_RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Espera de backoff cancelada'));
      },
      { once: true },
    );
  });
}

/**
 * Decodifica o corpo respeitando o charset declarado no Content-Type.
 *
 * NÃO use `response.text()`: o fetch do WHATWG decodifica SEMPRE como UTF-8 e
 * ignora o charset. O ingresso.com devolve algumas respostas em UTF-16
 * (observado em `/theaters/city/{id}/partnership/home`), e nesse caso o
 * `.text()` entrega lixo que quebra no JSON.parse — um "contrato quebrado"
 * falso que dispararia canary sem haver mudança nenhuma na API.
 */
function decodificarCorpo(buffer: ArrayBuffer, contentType: string | null): string {
  const declarado = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().toLowerCase();

  if (declarado && declarado !== 'utf-8') {
    try {
      return new TextDecoder(declarado).decode(buffer);
    } catch {
      // charset exótico ou inválido: cai para UTF-8 em vez de derrubar a requisição
    }
  }

  return new TextDecoder('utf-8').decode(buffer);
}

/** Retry-After vem em segundos ou como data HTTP. Devolve milissegundos. */
function lerRetryAfter(valor: string | null): number | undefined {
  if (!valor) return undefined;

  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);

  const data = Date.parse(valor);
  if (!Number.isNaN(data)) return Math.max(0, data - Date.now());

  return undefined;
}

export class HttpClient {
  private readonly semaforo: Semaphore;
  private readonly log;

  constructor(private readonly options: HttpClientOptions) {
    this.semaforo = new Semaphore(options.maxConcurrency ?? env.HTTP_MAX_CONCURRENCY);
    this.log = logger.child({ module: 'http', source: options.source });
  }

  async request(endpoint: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.semaforo.run(() => this.executar(endpoint, options));
  }

  private montarUrl(endpoint: string, query: RequestOptions['query']): { url: string; params: Record<string, string> } {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const caminho = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${base}${caminho}`);

    const params: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(query ?? {})) {
      if (valor === undefined || valor === null) continue;
      const texto = String(valor);
      url.searchParams.set(chave, texto);
      params[chave] = texto;
    }

    return { url: url.toString(), params };
  }

  private async executar(endpoint: string, options: RequestOptions): Promise<HttpResponse> {
    const { url, params } = this.montarUrl(endpoint, options.query);
    // `url` cru só é usado no fetch; tudo que vira log, evento ou erro usa o seguro
    const urlSegura = redigirUrl(url);
    const paramsSeguros = redigirParametros(params);
    const maxRetries = options.maxRetries ?? this.options.maxRetries ?? env.HTTP_MAX_RETRIES;
    const timeoutMs = this.options.timeoutMs ?? env.HTTP_TIMEOUT_MS;
    const baseDelayMs = this.options.baseDelayMs ?? env.HTTP_BASE_DELAY_MS;

    const inicio = Date.now();
    let tentativa = 0;
    let ultimoErro: unknown;

    while (tentativa <= maxRetries) {
      tentativa += 1;

      const sinais: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
      if (options.signal) sinais.push(options.signal);

      try {
        const resposta = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            'User-Agent': this.options.userAgent ?? env.INGRESSO_USER_AGENT,
            Accept: 'application/json',
            ...this.options.defaultHeaders,
            ...options.headers,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.any(sinais),
          redirect: 'follow',
        });

        const headers = Object.fromEntries(resposta.headers.entries());
        const bodyText = decodificarCorpo(
          await resposta.arrayBuffer(),
          resposta.headers.get('content-type'),
        );

        const throttleDisfarcado =
          (this.options.retryEmpty400 ?? false) &&
          resposta.status === 400 &&
          bodyText.trim() === '';

        const podeTentarDeNovo =
          (STATUS_QUE_MERECEM_RETRY.has(resposta.status) || throttleDisfarcado) &&
          tentativa <= maxRetries;

        if (!resposta.ok && podeTentarDeNovo) {
          const retryAfter = lerRetryAfter(resposta.headers.get('retry-after'));
          const espera = retryAfter ?? this.calcularBackoff(tentativa, baseDelayMs);

          this.log.warn('resposta com status que merece nova tentativa', {
            endpoint,
            status: resposta.status,
            tentativa,
            esperaMs: espera,
            respeitandoRetryAfter: retryAfter !== undefined,
          });

          this.emitir({
            source: this.options.source,
            endpoint,
            url: urlSegura,
            outcome: resposta.status === 429 || throttleDisfarcado ? 'rate_limited' : 'http_error',
            httpStatus: resposta.status,
            attempts: tentativa,
            durationMs: Date.now() - inicio,
          });

          await esperar(espera, options.signal);
          continue;
        }

        const durationMs = Date.now() - inicio;

        this.emitir({
          source: this.options.source,
          endpoint,
          url: urlSegura,
          outcome: resposta.ok
            ? 'ok'
            : resposta.status === 403
              ? 'forbidden'
              : resposta.status === 429
                ? 'rate_limited'
                : 'http_error',
          httpStatus: resposta.status,
          attempts: tentativa,
          durationMs,
        });

        if (resposta.ok) {
          this.log.debug('requisição concluída', { endpoint, status: resposta.status, durationMs, tentativa });
        } else {
          // 403 persistente = bloqueio, severidade alta (§8). Quem chama grava o
          // RawPayload e dispara o canary; aqui só devolvemos o fato.
          this.log.warn('requisição sem sucesso', { endpoint, status: resposta.status, durationMs, tentativa });
        }

        return this.montarResposta({ url: urlSegura, endpoint, params: paramsSeguros, status: resposta.status, ok: resposta.ok, headers, bodyText, attempts: tentativa, durationMs });
      } catch (erro) {
        ultimoErro = erro;
        const foiTimeout = erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError');

        // cancelamento externo não é falha da fonte: propaga direto
        if (options.signal?.aborted) throw erro;

        if (tentativa > maxRetries) break;

        const espera = this.calcularBackoff(tentativa, baseDelayMs);
        this.log.warn('falha de rede, tentando de novo', {
          endpoint,
          tentativa,
          esperaMs: espera,
          erro: erro instanceof Error ? erro.message : String(erro),
        });

        this.emitir({
          source: this.options.source,
          endpoint,
          url: urlSegura,
          outcome: foiTimeout ? 'timeout' : 'network_error',
          attempts: tentativa,
          durationMs: Date.now() - inicio,
          error: erro instanceof Error ? erro.message : String(erro),
        });

        await esperar(espera, options.signal);
      }
    }

    const durationMs = Date.now() - inicio;
    const mensagem = ultimoErro instanceof Error ? ultimoErro.message : 'motivo desconhecido';
    const foiTimeout = ultimoErro instanceof Error && (ultimoErro.name === 'TimeoutError' || ultimoErro.name === 'AbortError');

    this.emitir({
      source: this.options.source,
      endpoint,
      url: urlSegura,
      outcome: foiTimeout ? 'timeout' : 'network_error',
      attempts: tentativa,
      durationMs,
      error: mensagem,
    });

    throw new ExternalApiError(
      `${this.options.source}: ${endpoint} falhou após ${tentativa} tentativa(s) — ${mensagem}`,
      this.options.source,
      undefined,
      { cause: ultimoErro, details: { url: urlSegura, params: paramsSeguros, durationMs } },
    );
  }

  /** Exponencial com jitter, para várias tentativas não baterem na mesma hora. */
  private calcularBackoff(tentativa: number, baseDelayMs: number): number {
    const exponencial = baseDelayMs * 2 ** (tentativa - 1);
    const teto = Math.min(exponencial, 30_000);
    return Math.round(teto / 2 + Math.random() * (teto / 2));
  }

  private emitir(evento: TransportEvent): void {
    try {
      this.options.onTransportEvent?.(evento);
    } catch (erro) {
      this.log.error('onTransportEvent lançou — canary não pode derrubar a requisição', { erro });
    }
  }

  private montarResposta(dados: Omit<HttpResponse, 'json'>): HttpResponse {
    const source = this.options.source;
    return {
      ...dados,
      json<T = unknown>(): T {
        try {
          return JSON.parse(dados.bodyText) as T;
        } catch (erro) {
          throw new ExternalApiError(
            `Resposta de ${dados.endpoint} não é JSON válido`,
            source,
            dados.status,
            { cause: erro, details: { trecho: dados.bodyText.slice(0, 200) } },
          );
        }
      },
    };
  }
}
