import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { logger } from '../../shared/logger';
import { portao } from '../users';
import { CAMINHO_FEED_EVENTOS_V1 } from './feed.types';
import { lerFeed, lerPedido } from './feed.service';

const log = logger.child({ module: 'feed' });

/**
 * Token de serviço do Portão (client credentials, escopo feed:read), não sessão de usuário.
 * Sem Portão (login por senha) ou, em dev, sem PORTAO_RECURSO, o feed responde 503 em vez
 * de derrubar o app inteiro.
 */
function protecaoDoFeed(): RequestHandler {
  const desligado = (motivo: string): RequestHandler => {
    log.warn(`feed do CG desligado: ${motivo}`);
    return (_req, res) => {
      res.status(503).json({ error: { code: 'FEED_SEM_CONFIGURACAO', message: `Feed desligado: ${motivo}` } });
    };
  };
  if (!portao) return desligado('o login pelo Portão não está ligado (PORTAO_ISSUER).');
  try {
    return portao.exigirServico('feed:read');
  } catch {
    return desligado('defina PORTAO_RECURSO (origem de produção do Cineon).');
  }
}

/** Montar em `/api` ANTES do `exigirPerfil`: quem chama é o backend do CG, sem sessão. */
export const feedRoutes = Router();

feedRoutes.get(
  CAMINHO_FEED_EVENTOS_V1,
  protecaoDoFeed(),
  asyncHandler(async (req, res) => {
    const pedido = lerPedido(req.query as Record<string, unknown>);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await lerFeed(pedido));
  }),
);
