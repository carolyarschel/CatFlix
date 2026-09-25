import express, { type Express } from 'express';
import { asyncHandler, errorHandler, notFoundHandler } from './shared/error-handler';
import { canariesRoutes } from './modules/canaries';
import { catalogRoutes } from './modules/catalog';
import { cinemasRoutes } from './modules/cinemas';
import { reviewRoutes } from './modules/review';
import { syncRoutes } from './modules/sync';
import { tagsRoutes } from './modules/tags';
import { authRoutes, exigirPerfil, lerSessao, usersRoutes } from './modules/users';
import { authConfigurada, isProduction } from './config/env';
import { prisma } from './shared/prisma';
import { logger } from './shared/logger';

const log = logger.child({ module: 'app' });

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // log de requisição — curto, só o que ajuda a depurar o sync
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on('finish', () => {
      log.debug('requisição', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - inicio,
      });
    });
    next();
  });

  /**
   * Health básico: o processo está de pé e o banco responde.
   * O estado do sync e do modo degradado fica em `/api/health/sync`.
   */
  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      let banco: 'ok' | 'indisponivel' = 'ok';
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        banco = 'indisponivel';
      }

      res.status(banco === 'ok' ? 200 : 503).json({
        status: banco === 'ok' ? 'ok' : 'degradado',
        banco,
        uptimeSegundos: Math.round(process.uptime()),
        agora: new Date().toISOString(),
      });
    }),
  );

  /**
   * Autenticação (§3, resolvida em 23/09/2026).
   *
   * `lerSessao` só anexa `req.perfil`; quem barra é `exigirPerfil`, logo
   * abaixo. A ordem importa: tudo que vier DEPOIS da linha do `exigirPerfil`
   * está protegido por padrão. Uma rota nova nasce fechada — que é o jeito
   * certo de errar.
   */
  app.use(lerSessao);
  app.use('/api', authRoutes);

  if (!authConfigurada()) {
    const recado =
      'Login sem configuração: defina AUTH_SECRET e AUTH_PASSWORD (ou AUTH_PASSWORD_CATFLIX / AUTH_PASSWORD_HBURSO) no .env.';
    if (isProduction) throw new Error(recado);
    log.warn(recado);
  }

  app.use('/api', exigirPerfil);

  // ── daqui para baixo, só com sessão ────────────────────────
  // As rotas dos módulos entram aqui, na ordem da seção 15.
  app.use('/api', syncRoutes);
  app.use('/api', canariesRoutes);
  app.use('/api', reviewRoutes);
  // leitura do catálogo — o que as telas do passo 10 consomem
  app.use('/api', catalogRoutes);
  app.use('/api', cinemasRoutes);
  app.use('/api', tagsRoutes);
  app.use('/api', usersRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
