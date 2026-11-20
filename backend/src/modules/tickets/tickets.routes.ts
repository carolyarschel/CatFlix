import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import {
  deleteIngresso,
  getIngressos,
  getIngressosAtivos,
  patchIngresso,
  postAssistido,
  postIngresso,
} from './tickets.controller';

export const ticketsRoutes = Router();

ticketsRoutes.get('/tickets', asyncHandler(getIngressosAtivos));
ticketsRoutes.get('/titles/:id/tickets', asyncHandler(getIngressos));
ticketsRoutes.post('/titles/:id/tickets', asyncHandler(postIngresso));
ticketsRoutes.post('/tickets/:id/assistido', asyncHandler(postAssistido));
ticketsRoutes.patch('/tickets/:id', asyncHandler(patchIngresso));
ticketsRoutes.delete('/tickets/:id', asyncHandler(deleteIngresso));
