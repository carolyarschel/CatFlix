import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { dispararSync, healthDoSync, listarJobs } from './sync.controller';

export const syncRoutes = Router();

// §10 do contexto
syncRoutes.post('/sync/run', asyncHandler(dispararSync));
syncRoutes.get('/sync/jobs', listarJobs);
syncRoutes.get('/health/sync', asyncHandler(healthDoSync));
