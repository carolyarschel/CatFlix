import { Router } from 'express';
import { asyncHandler } from '../../shared/error-handler';
import { deleteWatchlist, getWatchlist, postRestaurar, putWatchlist } from './watchlist.controller';

export const watchlistRoutes = Router();

// cineon-expansao §9
watchlistRoutes.get('/watchlist', asyncHandler(getWatchlist));
watchlistRoutes.post('/watchlist/restaurar', asyncHandler(postRestaurar));
watchlistRoutes.put('/titles/:id/watchlist', asyncHandler(putWatchlist));
watchlistRoutes.delete('/titles/:id/watchlist', asyncHandler(deleteWatchlist));
