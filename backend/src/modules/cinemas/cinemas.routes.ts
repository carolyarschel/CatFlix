import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { ValidationError } from '../../shared/errors';
import { listarCinemas, listarSessoes } from './cinemas.queries';

export const cinemasRoutes = Router();

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}

// §10: GET /sessions?titleId=&date=
cinemasRoutes.get(
  '/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const titleId = texto(req.query.titleId);
    const cinemaId = texto(req.query.cinemaId);

    if (!titleId && !cinemaId) {
      throw new ValidationError('Informe titleId ou cinemaId.');
    }

    const grupos = await listarSessoes({
      titleId,
      cinemaId,
      dia: texto(req.query.date) ?? texto(req.query.dia),
    });

    res.json({ grupos, total: grupos.reduce((n, g) => n + g.sessoes.length, 0) });
  }),
);

cinemasRoutes.get(
  '/cinemas',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ itens: await listarCinemas() });
  }),
);
