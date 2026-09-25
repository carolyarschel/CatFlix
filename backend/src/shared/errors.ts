/**
 * Erros do domínio. A regra do projeto é nunca contornar um problema em
 * silêncio: cada tipo aqui existe para que o handler saiba a diferença entre
 * "o usuário pediu errado", "a fonte externa caiu" e "a fonte externa mudou".
 */

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.details = options?.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/**
 * A fonte externa respondeu mal (status inesperado, timeout, 429, 403).
 * Alimenta o canary de TRANSPORTE (§8).
 */
export class ExternalApiError extends AppError {
  readonly statusCode = 502;
  readonly code = 'EXTERNAL_API_ERROR';

  constructor(
    message: string,
    readonly source: string,
    readonly httpStatus?: number,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * A fonte externa respondeu, mas o payload não bate mais com o schema zod:
 * campo sumiu, mudou de tipo, formato de URL mudou.
 * Alimenta o canary de CONTRATO (§8) e IMPEDE que o catálogo seja atualizado
 * com dado quebrado (§7.1).
 */
export class ContractError extends AppError {
  readonly statusCode = 502;
  readonly code = 'CONTRACT_ERROR';

  constructor(
    message: string,
    readonly source: string,
    readonly endpoint: string,
    options?: { details?: unknown; cause?: unknown; rawPayloadId?: string },
  ) {
    super(message, options);
    this.rawPayloadId = options?.rawPayloadId;
  }

  /** Aponta para o RawPayload que falhou, para reprocessar depois sem rechamar a API. */
  readonly rawPayloadId?: string;
}

export function isAppError(erro: unknown): erro is AppError {
  return erro instanceof AppError;
}
