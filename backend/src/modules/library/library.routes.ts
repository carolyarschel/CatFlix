import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import {
  deleteNota,
  deleteTitulo,
  getAssistidos,
  getBusca,
  getOndeAssistir,
  getTitulo,
  patchTitulo,
  postRestaurarTitulo,
  postTitulo,
  postTituloManual,
  postVisualizacao,
  putNota,
} from './library.controller';

export const libraryRoutes = Router();

// cineon-expansao §9 — as rotas que cruzam módulos
libraryRoutes.get('/tmdb/search', asyncHandler(getBusca));
libraryRoutes.get('/assistidos', asyncHandler(getAssistidos));

libraryRoutes.post('/library/titles', asyncHandler(postTitulo));
libraryRoutes.post('/library/titles/manual', asyncHandler(postTituloManual));
libraryRoutes.get('/library/titles/:id', asyncHandler(getTitulo));
libraryRoutes.patch('/library/titles/:id', asyncHandler(patchTitulo));
libraryRoutes.delete('/library/titles/:id', asyncHandler(deleteTitulo));
libraryRoutes.post('/library/titles/:id/restaurar', asyncHandler(postRestaurarTitulo));

libraryRoutes.post('/titles/:id/watches', asyncHandler(postVisualizacao));
libraryRoutes.put('/titles/:id/rating', asyncHandler(putNota));
libraryRoutes.get('/titles/:id/where-to-watch', asyncHandler(getOndeAssistir));
libraryRoutes.delete('/titles/:id/rating', asyncHandler(deleteNota));
