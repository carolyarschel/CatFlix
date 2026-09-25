import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { ValidationError } from '../../shared/errors';
import { z } from 'zod';
import { getSessao, postLogin, postLogout } from './users.controller';
import { perfilDaRequisicao } from './users.middleware';
import { buscarPerfil, definirEstado, limparEstado, listarPerfis } from './users.service';

/**
 * Rotas PÚBLICAS de autenticação (§3). São as únicas fora do middleware, junto
 * com o health — sem elas não haveria como entrar.
 */
export const authRoutes = Router();

authRoutes.get('/auth/sessao', asyncHandler(getSessao));
authRoutes.post('/auth/login', asyncHandler(postLogin));
authRoutes.post('/auth/logout', postLogout);

/** Rotas de perfil, já atrás da autenticação. */
export const usersRoutes = Router();

usersRoutes.get(
  '/users',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ itens: await listarPerfis() });
  }),
);

usersRoutes.get(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError('Id do perfil ausente ou inválido.');
    }
    res.json(await buscarPerfil(id));
  }),
);

// ── Estado do usuário (§10, passo 11) ────────────────────────

const estadoSchema = z.object({ status: z.enum(['quero_ver', 'marcado', 'visto']) });

/**
 * `:userId` da rota tem de ser o perfil da SESSÃO.
 *
 * O §3 já diz isso do `?user=`: sem a checagem, trocar o id na URL marcaria
 * filme no nome do outro. `perfilDaRequisicao` cobre a query; o parâmetro de
 * rota é o mesmo problema por outro caminho.
 */
function perfilDono(req: Request): string {
  const daSessao = perfilDaRequisicao(req);
  const pedido = req.params.userId;

  if (typeof pedido !== 'string' || pedido.length === 0) {
    throw new ValidationError('Id do perfil ausente ou inválido.');
  }
  if (pedido !== daSessao) {
    throw new ValidationError(`Sessão é de "${daSessao}": não dá para marcar por "${pedido}".`);
  }

  return daSessao;
}

function titleIdDaRota(req: Request): string {
  const id = req.params.titleId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('Id do título ausente ou inválido.');
  }
  return id;
}

usersRoutes.put(
  '/users/:userId/titles/:titleId/state',
  asyncHandler(async (req: Request, res: Response) => {
    const corpo = estadoSchema.safeParse(req.body);
    if (!corpo.success) {
      throw new ValidationError('Estado inválido.', {
        details: { validos: ['quero_ver', 'marcado', 'visto'], issues: corpo.error.issues },
      });
    }

    res.json(await definirEstado(perfilDono(req), titleIdDaRota(req), corpo.data.status));
  }),
);

/**
 * Desmarcar. O §10 só previu o `PUT`, mas sem isto "marquei sem querer" não tem
 * volta — e um quarto status "nenhum" sujaria todo filtro por estado (§6).
 */
usersRoutes.delete(
  '/users/:userId/titles/:titleId/state',
  asyncHandler(async (req: Request, res: Response) => {
    const removido = await limparEstado(perfilDono(req), titleIdDaRota(req));
    res.json({ removido });
  }),
);
