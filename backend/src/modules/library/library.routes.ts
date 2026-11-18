import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import {
  deleteNota,
  deleteTitulo,
  getBusca,
  getTitulo,
  patchTitulo,
  postRestaurarTitulo,
  postTitulo,
  postVisualizacao,
  putNota,
} from './library.controller';

export const libraryRoutes = Router();

// cineon-expansao §9 — as rotas que cruzam módulos
libraryRoutes.get('/tmdb/search', asyncHandler(getBusca));

libraryRoutes.post('/library/titles', asyncHandler(postTitulo));
libraryRoutes.get('/library/titles/:id', asyncHandler(getTitulo));
libraryRoutes.patch('/library/titles/:id', asyncHandler(patchTitulo));
libraryRoutes.delete('/library/titles/:id', asyncHandler(deleteTitulo));
libraryRoutes.post('/library/titles/:id/restaurar', asyncHandler(postRestaurarTitulo));

libraryRoutes.post('/titles/:id/watches', asyncHandler(postVisualizacao));
libraryRoutes.put('/titles/:id/rating', asyncHandler(putNota));
libraryRoutes.delete('/titles/:id/rating', asyncHandler(deleteNota));
