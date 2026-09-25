import type { z } from 'zod';
import { env, requireEnv } from '../../config/env';
import { tmdbConfig } from '../../config/metadata';
import { ContractError, ExternalApiError } from '../../shared/errors';
import { HttpClient, type TransportEvent } from '../../shared/http';
import { logger } from '../../shared/logger';
import { registrarRawPayload } from '../../shared/raw-payload';
import {
  tmdbErrorSchema,
  tmdbMovieSchema,
  tmdbSearchResponseSchema,
  type TmdbMovie,
  type TmdbSearchResponse,
} from './tmdb.schemas';

const log = logger.child({ module: 'tmdb' });

export interface TmdbClientOptions {
  syncRunId?: string;
  onTransportEvent?: (evento: TransportEvent) => void;
}

export interface RespostaTmdb<T> {
  dados: T;
  rawPayloadId: string;
}

/**
 * Cliente do TMDB (§5.2).
 *
 * Mesmo fluxo do ingresso: fetch → RawPayload → zod. A diferença é que a
 * chave vai na query string, então `RawPayload.params` e qualquer log passam
 * pela redação de `shared/redact` — a chave da Carol não pode acabar no banco.
 */
export class TmdbClient {
  private readonly http: HttpClient;

  constructor(private readonly options: TmdbClientOptions = {}) {
    this.http = new HttpClient({
      source: 'tmdb',
      baseUrl: env.TMDB_BASE_URL,
      userAgent: env.INGRESSO_USER_AGENT,
      ...(options.onTransportEvent ? { onTransportEvent: options.onTransportEvent } : {}),
    });
  }

  /**
   * `search/movie` com título e, quando houver, ano (§5.2).
   *
   * Busca sem resultado devolve `total_results: 0` e lista vazia — ausência,
   * não erro. Quem decide o que fazer com isso é o matching.
   */
  async buscarFilmes(
    query: string,
    opcoes: { ano?: number | null; pagina?: number } = {},
  ): Promise<RespostaTmdb<TmdbSearchResponse>> {
    return this.pedir('/search/movie', tmdbSearchResponseSchema, {
      query,
      ...(opcoes.ano ? { primary_release_year: String(opcoes.ano) } : {}),
      ...(opcoes.pagina ? { page: String(opcoes.pagina) } : {}),
      include_adult: 'false',
    });
  }

  /** Detalhe completo, com créditos, ids externos e datas de lançamento. */
  async buscarFilme(tmdbId: number): Promise<RespostaTmdb<TmdbMovie>> {
    return this.pedir(`/movie/${tmdbId}`, tmdbMovieSchema, {
      append_to_response: tmdbConfig.appendToResponse,
    });
  }

  private async pedir<T extends z.ZodTypeAny>(
    endpoint: string,
    schema: T,
    query: Record<string, string>,
  ): Promise<RespostaTmdb<z.infer<T>>> {
    const resposta = await this.http.request(endpoint, {
      query: {
        api_key: requireEnv('TMDB_API_KEY'),
        language: tmdbConfig.language,
        ...query,
      },
    });

    // 1. bruto primeiro, sempre (§7.1) — a chave é redigida lá dentro
    const rawPayloadId = await registrarRawPayload({
      source: 'tmdb',
      endpoint,
      params: resposta.params,
      bodyText: resposta.bodyText,
      httpStatus: resposta.status,
      ...(this.options.syncRunId ? { syncRunId: this.options.syncRunId } : {}),
    });

    // 2. o TMDB erra com corpo estruturado: aproveita a mensagem dele
    if (!resposta.ok) {
      const erroTmdb = tmdbErrorSchema.safeParse(safeJson(resposta.bodyText));
      const detalhe = erroTmdb.success
        ? `${erroTmdb.data.status_message} (status_code ${erroTmdb.data.status_code})`
        : resposta.bodyText.slice(0, 200);

      throw new ExternalApiError(`TMDB ${endpoint}: ${detalhe}`, 'tmdb', resposta.status, {
        details: { rawPayloadId },
      });
    }

    const corpo = safeJson(resposta.bodyText);
    if (corpo === undefined) {
      throw new ContractError(`TMDB ${endpoint} não devolveu JSON`, 'tmdb', endpoint, {
        rawPayloadId,
        details: { trecho: resposta.bodyText.slice(0, 200) },
      });
    }

    const validado = schema.safeParse(corpo);
    if (!validado.success) {
      const issues = validado.error.issues.slice(0, 10).map((i) => ({
        campo: i.path.join('.') || '(raiz)',
        problema: i.message,
      }));
      log.error('payload do TMDB não bate com o schema', { endpoint, issues, rawPayloadId });

      throw new ContractError(
        `TMDB ${endpoint}: o payload não bate mais com o schema`,
        'tmdb',
        endpoint,
        { rawPayloadId, details: { issues } },
      );
    }

    return { dados: validado.data as z.infer<T>, rawPayloadId };
  }
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
