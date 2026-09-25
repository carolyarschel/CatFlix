import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { getHome, getTitle, getTitles } from './catalog.controller';

export const catalogRoutes = Router();

// §10 do contexto
catalogRoutes.get('/home', asyncHandler(getHome));
catalogRoutes.get('/titles', asyncHandler(getTitles));
catalogRoutes.get('/titles/:id', asyncHandler(getTitle));
