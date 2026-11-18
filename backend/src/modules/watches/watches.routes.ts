import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { deleteWatch, getWatches, patchWatch } from './watches.controller';

export const watchesRoutes = Router();

// cineon-expansao §9. O POST mora no `library`: registrar também tira o filme
// da lista "quero assistir", e isso cruza módulos.
watchesRoutes.get('/watches', asyncHandler(getWatches));
watchesRoutes.patch('/watches/:id', asyncHandler(patchWatch));
watchesRoutes.delete('/watches/:id', asyncHandler(deleteWatch));
