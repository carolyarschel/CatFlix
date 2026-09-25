import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isProduction } from '../config/env';
import { isAppError } from './errors';
import { logger } from './logger';

const log = logger.child({ module: 'http-server' });

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Rota não encontrada: ${req.method} ${req.originalUrl}` },
  });
};

export const errorHandler: ErrorRequestHandler = (erro, req, res, _next) => {
  if (isAppError(erro)) {
    const nivel = erro.statusCode >= 500 ? 'error' : 'warn';
    log[nivel](erro.message, { code: erro.code, path: req.originalUrl, details: erro.details });

    res.status(erro.statusCode).json({
      error: {
        code: erro.code,
        message: erro.message,
        ...(erro.details !== undefined ? { details: erro.details } : {}),
      },
    });
    return;
  }

  log.error('erro não tratado', { erro, path: req.originalUrl, method: req.method });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'Erro interno.'
        : erro instanceof Error
          ? erro.message
          : String(erro),
    },
  });
};

/** Envolve handlers async para que uma promise rejeitada chegue ao errorHandler. */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
