import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { getHome, getProgramacao, getTitle, getTitles } from './catalog.controller';

export const catalogRoutes = Router();

// §10 do contexto
catalogRoutes.get('/home', asyncHandler(getHome));
catalogRoutes.get('/titles', asyncHandler(getTitles));
catalogRoutes.get('/titles/:id', asyncHandler(getTitle));

// acréscimo ao §10: o que dá para ver num dia, filme a filme
catalogRoutes.get('/programacao', asyncHandler(getProgramacao));
