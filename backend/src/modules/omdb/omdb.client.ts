import { env, requireEnv } from '../../config/env';
import { ContractError, ExternalApiError } from '../../shared/errors';
import { HttpClient, type TransportEvent } from '../../shared/http';
import { logger } from '../../shared/logger';
import { registrarRawPayload } from '../../shared/raw-payload';
import { normalizarNotas } from './omdb.parse';
import { omdbResponseSchema } from './omdb.schemas';
import type { ResultadoOmdb } from './omdb.types';

const log = logger.child({ module: 'omdb' });

export interface OmdbClientOptions {
  syncRunId?: string;
  onTransportEvent?: (evento: TransportEvent) => void;
}

export class OmdbClient {
  private readonly http: HttpClient;

  constructor(private readonly options: OmdbClientOptions = {}) {
    this.http = new HttpClient({
      source: 'omdb',
      baseUrl: env.OMDB_BASE_URL,
      userAgent: env.INGRESSO_USER_AGENT,
      // tier grátis de 1.000/dia: não faz sentido paralelizar muito
      maxConcurrency: 2,
      ...(options.onTransportEvent ? { onTransportEvent: options.onTransportEvent } : {}),
    });
  }

  /**
   * Notas de um filme, **sempre por `imdb_id`** — nunca por título (§5.3).
   *
   * ⚠️ Este método NUNCA deve ser chamado durante uma requisição de usuário.
   * Só em job (§5.3).
   */
  async buscarNotas(imdbId: string): Promise<ResultadoOmdb> {
    const resposta = await this.http.request('/', {
      query: { apikey: requireEnv('OMDB_API_KEY'), i: imdbId },
    });

    const rawPayloadId = await registrarRawPayload({
      source: 'omdb',
      endpoint: '/',
      params: resposta.params,
      bodyText: resposta.bodyText,
      httpStatus: resposta.status,
      ...(this.options.syncRunId ? { syncRunId: this.options.syncRunId } : {}),
    });

    // 401 = chave inválida. Isso é problema de configuração e precisa ser alto.
    if (!resposta.ok) {
      throw new ExternalApiError(
        `OMDb respondeu ${resposta.status} para ${imdbId}`,
        'omdb',
        resposta.status,
        { details: { rawPayloadId, trecho: resposta.bodyText.slice(0, 200) } },
      );
    }

    let corpo: unknown;
    try {
      corpo = resposta.json();
    } catch (erro) {
      throw new ContractError('OMDb não devolveu JSON', 'omdb', '/', {
        cause: erro,
        rawPayloadId,
        details: { trecho: resposta.bodyText.slice(0, 200) },
      });
    }

    const validado = omdbResponseSchema.safeParse(corpo);
    if (!validado.success) {
      throw new ContractError('OMDb: o payload não bate mais com o schema', 'omdb', '/', {
        rawPayloadId,
        details: {
          issues: validado.error.issues.slice(0, 5).map((i) => ({
            campo: i.path.join('.') || '(raiz)',
            problema: i.message,
          })),
        },
      });
    }

    // ⚠️ AQUI está a armadilha do OMDb: HTTP 200 com Response: "False".
    // Quem olhar só o status grava nota de filme errado ou explode no parse.
    if (validado.data.Response === 'False') {
      log.warn('OMDb não conhece este imdb_id', { imdbId, motivo: validado.data.Error });
      return { tipo: 'nao_encontrado', motivo: validado.data.Error, rawPayloadId };
    }

    return { tipo: 'notas', notas: normalizarNotas(validado.data), rawPayloadId };
  }
}
