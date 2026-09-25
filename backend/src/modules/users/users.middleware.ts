import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { NOME_DO_COOKIE, lerCookie, lerToken } from './users.sessao';

/**
 * O middleware de autenticação isolado que o §3 pediu.
 *
 * Todo o resto do app pergunta `req.perfil` e não sabe de onde veio. Trocar
 * cookie por JWT, ou por sessão compartilhada com o Crônicas de Gatur (§14),
 * é mexer aqui e em `users.sessao.ts` — em nenhum controller.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** perfil autenticado; indefinido em rota pública */
      perfil?: string;
    }
  }
}

export class NaoAutenticadoError extends AppError {
  readonly statusCode = 401;
  readonly code = 'NAO_AUTENTICADO';
}

/** Anexa `req.perfil` quando há sessão válida. Nunca bloqueia. */
export function lerSessao(req: Request, _res: Response, next: NextFunction): void {
  const token = lerCookie(req.headers.cookie, NOME_DO_COOKIE);
  const perfil = lerToken(token);
  if (perfil) req.perfil = perfil;
  next();
}

/** Bloqueia quem não tem sessão. Vai na frente de tudo que não for público. */
export function exigirPerfil(req: Request, _res: Response, next: NextFunction): void {
  if (!req.perfil) {
    throw new NaoAutenticadoError('Entre com um perfil para continuar.');
  }
  next();
}

/**
 * O perfil da requisição.
 *
 * Aceita `?user=` **apenas** quando bate com o perfil da sessão. Antes do login
 * existir, a query era a única fonte; mantê-la aberta agora deixaria a Carol ver
 * a home do namorado trocando um parâmetro na URL — e o §1 diz que cada perfil
 * tem o seu estado.
 */
export function perfilDaRequisicao(req: Request): string {
  const daSessao = req.perfil;
  if (!daSessao) {
    throw new NaoAutenticadoError('Entre com um perfil para continuar.');
  }

  const pedido = req.query.user;
  if (typeof pedido === 'string' && pedido.length > 0 && pedido !== daSessao) {
    throw new NaoAutenticadoError(`Sessão é de "${daSessao}", não de "${pedido}".`);
  }

  return daSessao;
}
