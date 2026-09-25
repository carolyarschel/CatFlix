import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import {
  chaveDePush,
  desinscreverDispositivo,
  inscreverDispositivo,
  listarAlertas,
} from './push.controller';

export const canariesRoutes = Router();

canariesRoutes.get('/push/chave', asyncHandler(chaveDePush));
canariesRoutes.post('/push/inscrever', asyncHandler(inscreverDispositivo));
canariesRoutes.post('/push/desinscrever', asyncHandler(desinscreverDispositivo));
canariesRoutes.get('/alertas', asyncHandler(listarAlertas));
