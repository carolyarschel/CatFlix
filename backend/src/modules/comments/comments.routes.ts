import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { deleteComentario, putComentario } from './comments.controller';

export const commentsRoutes = Router();

commentsRoutes.put('/titles/:id/comment', asyncHandler(putComentario));
commentsRoutes.delete('/titles/:id/comment', asyncHandler(deleteComentario));
