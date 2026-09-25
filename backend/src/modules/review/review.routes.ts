import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import {
  getBusca,
  getContagem,
  getFila,
  postConfirmar,
  postDispensar,
  postMesclar,
  postNaoEhFilme,
  postSubstituir,
} from './review.controller';

export const reviewRoutes = Router();

// §10 do contexto
reviewRoutes.get('/review', asyncHandler(getFila));
reviewRoutes.get('/review/count', asyncHandler(getContagem));
reviewRoutes.get('/review/buscar', asyncHandler(getBusca));
reviewRoutes.post('/review/:id/confirm', asyncHandler(postConfirmar));
reviewRoutes.post('/review/:id/replace', asyncHandler(postSubstituir));
reviewRoutes.post('/review/:id/not-a-film', asyncHandler(postNaoEhFilme));
reviewRoutes.post('/review/:id/merge', asyncHandler(postMesclar));
// acréscimo ao §10: sem ele, um filme que o TMDB não tem fica na fila para sempre
reviewRoutes.post('/review/:id/dismiss', asyncHandler(postDispensar));
