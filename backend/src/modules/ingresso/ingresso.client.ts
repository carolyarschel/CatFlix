import type { z } from 'zod';
import { env } from '../../config/env';
import { ContractError, ExternalApiError } from '../../shared/errors';
import { HttpClient, type TransportEvent } from '../../shared/http';
import { logger } from '../../shared/logger';
import { registrarRawPayload } from '../../shared/raw-payload';
import {
  eventsResponseSchema,
  sessionsResponseSchema,
  statesResponseSchema,
  theatersResponseSchema,
  type RawEvent,
  type RawShowtimeDay,
  type RawTheater,
  type RawState,
} from './ingresso.schemas';
import type { RespostaIngresso } from './ingresso.types';

const log = logger.child({ module: 'ingresso' });

export interface IngressoClientOptions {
  syncRunId?: string;
  onTransportEvent?: (evento: TransportEvent) => void;
}

/**
 * Cliente do ingresso.com.
 *
 * O fluxo de TODA busca é o mesmo, e é o do §7.1:
 *   fetch → grava RawPayload → valida com zod → devolve
 *
 * Se a validação falhar, lança `ContractError` carregando o `rawPayloadId`.
 * O catálogo **não** é atualizado com dado quebrado, e o payload fica guardado
 * para reprocessar depois sem rechamar a API.
 *
 * Este módulo não conhece o catálogo, o matching nem os canaries (§11). O que
 * ele oferece ao mundo é o gancho `onTransportEvent`.
 */
export class IngressoClient {
  private readonly http: HttpClient;
  private readonly partnership: string;

  constructor(private readonly options: IngressoClientOptions = {}) {
    this.partnership = env.INGRESSO_PARTNERSHIP;
    this.http = new HttpClient({
      source: 'ingresso',
      baseUrl: env.INGRESSO_BASE_URL,
      userAgent: env.INGRESSO_USER_AGENT,
      maxConcurrency: env.HTTP_MAX_CONCURRENCY,
      // o ingresso sinaliza throttle com 400 + corpo vazio, não com 429
      retryEmpty400: true,
      ...(options.onTransportEvent ? { onTransportEvent: options.onTransportEvent } : {}),
    });
  }

  // ── endpoints ──────────────────────────────────────────────

  /** Estados e cidades, com fuso horário. Único endpoint sem `partnership`. */
  async buscarEstados(): Promise<RespostaIngresso<RawState[]>> {
    return this.buscar('/states', statesResponseSchema);
  }

  async buscarCinemasDaCidade(cityId: string): Promise<RespostaIngresso<RawTheater[]>> {
    const resposta = await this.buscar(
      `/theaters/city/${cityId}/partnership/${this.partnership}`,
      theatersResponseSchema,
    );
    return { ...resposta, dados: resposta.dados.items };
  }

  /**
   * Sessões de um cinema, um item por dia.
   *
   * Dois comportamentos que o OpenAPI não conta (CONTRATO.md §4.3):
   * a resposta é um ARRAY (o spec declara objeto), e um cinema sem sessão
   * responde **204 com corpo vazio** — que aqui vira lista vazia, não erro.
   */
  async buscarSessoesDoCinema(
    cityId: string,
    theaterId: string,
    date?: string,
  ): Promise<RespostaIngresso<RawShowtimeDay[]>> {
    return this.buscar(
      `/sessions/city/${cityId}/theater/${theaterId}/partnership/${this.partnership}`,
      sessionsResponseSchema,
      { query: date ? { date } : undefined, vazioSeSemConteudo: [] },
    );
  }

  async buscarEmCartaz(cityId: string, limite = 500): Promise<RespostaIngresso<RawEvent[]>> {
    return this.buscarLista(`/templates/nowplaying/${cityId}/partnership/${this.partnership}`, limite);
  }

  async buscarPreEstreias(cityId: string): Promise<RespostaIngresso<RawEvent[]>> {
    const resposta = await this.buscar(
      `/templates/premiere/${cityId}/partnership/${this.partnership}`,
      eventsResponseSchema,
    );
    return { ...resposta, dados: resposta.dados.items };
  }

  async buscarEmBreve(cityId: string, limite = 500): Promise<RespostaIngresso<RawEvent[]>> {
    return this.buscarLista(`/templates/soon/${cityId}/partnership/${this.partnership}`, limite);
  }

  // ── motor ──────────────────────────────────────────────────

  /**
   * `count` é o tamanho da página, não o total, e não existe campo de total
   * (CONTRATO.md §4.4). Então pedimos um limite alto e conferimos: se voltou
   * exatamente o limite, provavelmente há mais e avisamos — em vez de servir
   * um catálogo truncado achando que está completo.
   */
  private async buscarLista(endpoint: string, limite: number): Promise<RespostaIngresso<RawEvent[]>> {
    const resposta = await this.buscar(endpoint, eventsResponseSchema, {
      query: { limit: String(limite) },
    });

    if (resposta.dados.count >= limite) {
      log.warn('lista veio cheia até o limite: pode estar truncada', {
        endpoint,
        limite,
        count: resposta.dados.count,
      });
    }

    return { ...resposta, dados: resposta.dados.items };
  }

  private async buscar<T extends z.ZodTypeAny>(
    endpoint: string,
    schema: T,
    opcoes: {
      query?: Record<string, string> | undefined;
      /** valor a devolver quando a API responde 204/corpo vazio */
      vazioSeSemConteudo?: z.infer<T>;
    } = {},
  ): Promise<RespostaIngresso<z.infer<T>>> {
    const resposta = await this.http.request(endpoint, { query: opcoes.query });

    // 1. grava o bruto ANTES de qualquer parsing (§7.1)
    const rawPayloadId = await registrarRawPayload({
      source: 'ingresso',
      endpoint,
      params: resposta.params,
      bodyText: resposta.bodyText,
      httpStatus: resposta.status,
      ...(this.options.syncRunId ? { syncRunId: this.options.syncRunId } : {}),
    });

    // 2. status ruim ANTES de qualquer coisa.
    //    Esta ordem importa: a API sinaliza throttle com `400` e corpo vazio,
    //    e checar "corpo vazio" primeiro transformava isso em "cinema sem
    //    sessão" — o sync marcaria as sessões como sumidas e limparia a grade
    //    inteira sem ninguém ver. `resposta.ok` já inclui 204.
    if (!resposta.ok) {
      throw new ExternalApiError(
        `${endpoint} respondeu ${resposta.status}`,
        'ingresso',
        resposta.status,
        { details: { rawPayloadId, trecho: resposta.bodyText.slice(0, 300) } },
      );
    }

    // 3. 204 / corpo vazio COM status de sucesso: ausência de conteúdo, não falha
    const semConteudo = resposta.status === 204 || resposta.bodyText.trim() === '';
    if (semConteudo) {
      if (opcoes.vazioSeSemConteudo !== undefined) {
        log.debug('resposta sem conteúdo tratada como vazia', { endpoint, status: resposta.status });
        return {
          dados: opcoes.vazioSeSemConteudo as z.infer<T>,
          rawPayloadId,
          httpStatus: resposta.status,
          vazio: true,
        };
      }
      throw new ContractError(
        `${endpoint} respondeu ${resposta.status} sem corpo, e este endpoint deveria trazer conteúdo`,
        'ingresso',
        endpoint,
        { rawPayloadId },
      );
    }

    // 4. só agora parseia e valida
    let corpo: unknown;
    try {
      corpo = resposta.json();
    } catch (erro) {
      throw new ContractError(`${endpoint} não devolveu JSON`, 'ingresso', endpoint, {
        cause: erro,
        rawPayloadId,
        details: { trecho: resposta.bodyText.slice(0, 300) },
      });
    }

    const validado = schema.safeParse(corpo);
    if (!validado.success) {
      const issues = validado.error.issues.slice(0, 10).map((i) => ({
        campo: i.path.join('.') || '(raiz)',
        problema: i.message,
      }));

      log.error('payload do ingresso não bate com o schema', { endpoint, issues, rawPayloadId });

      // NÃO atualiza o catálogo com dado quebrado (§7.1)
      throw new ContractError(
        `${endpoint}: o payload não bate mais com o schema (${issues.length} problema(s))`,
        'ingresso',
        endpoint,
        { rawPayloadId, details: { issues } },
      );
    }

    return {
      dados: validado.data as z.infer<T>,
      rawPayloadId,
      httpStatus: resposta.status,
      vazio: false,
    };
  }
}
