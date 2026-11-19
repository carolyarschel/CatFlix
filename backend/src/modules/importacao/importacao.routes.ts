import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { ValidationError } from '../../shared/errors';
import { aplicarImportacao, estadoDaImportacao, iniciarSimulacao } from './importacao.cg.tarefa';

/**
 * Importação do Crônicas de Gatur pela tela do app (cineon-expansao §11).
 * Atrás do login, como tudo em `/api` (§3).
 */
export const importacaoRoutes = Router();

/**
 * `POST /importacao/cg` — o dump inteiro no corpo, como texto. O dump de
 * 19/11/2026 tem 500 KB; o limite de 25 MB é folga, não meta. O `express.json`
 * global ignora corpo que não é JSON, então quem lê este é o `express.text`.
 */
importacaoRoutes.post(
  '/importacao/cg',
  express.text({ type: () => true, limit: '25mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const dump = typeof req.body === 'string' ? req.body : '';
    if (dump.trim().length === 0) {
      throw new ValidationError('Envie o arquivo do dump no corpo da requisição.');
    }
    res.status(202).json(iniciarSimulacao(dump, req.perfil ?? 'desconhecido'));
  }),
);

importacaoRoutes.get(
  '/importacao/cg/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(estadoDaImportacao(String(req.params.id)));
  }),
);

importacaoRoutes.post(
  '/importacao/cg/:id/aplicar',
  asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(aplicarImportacao(String(req.params.id)));
  }),
);
