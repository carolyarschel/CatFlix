import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { deleteIngresso, getIngressos, patchIngresso, postIngresso } from './tickets.controller';

export const ticketsRoutes = Router();

ticketsRoutes.get('/titles/:id/tickets', asyncHandler(getIngressos));
ticketsRoutes.post('/titles/:id/tickets', asyncHandler(postIngresso));
ticketsRoutes.patch('/tickets/:id', asyncHandler(patchIngresso));
ticketsRoutes.delete('/tickets/:id', asyncHandler(deleteIngresso));
