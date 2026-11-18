import type { Request, Response } from 'express';
import { z } from 'zod';
import { lerCorpo, textoDaQuery as texto } from '../../shared/validacao';
import { editarVisualizacao, listarVisualizacoes, removerVisualizacao } from './watches.service';

/**
 * O formato de entrada de uma visualização. Exportado porque o orquestrador
 * `library` registra com o mesmo corpo (`POST /titles/:id/watches`).
 */
export const esquemaDaVisualizacao = z.object({
  data: z.string().min(4),
  local: z.enum(['CASA', 'CINEMA']),
  participantes: z.array(z.enum(['CAT', 'BEAR'])).min(1, 'Diga quem assistiu.'),
  cinemaId: z.string().min(1).nullish(),
  cinemaNomeLivre: z.string().max(120).nullish(),
  tipoSala: z.string().max(40).nullish(),
  observacao: z.string().max(1000).nullish(),
});

const filtros = z.object({
  pessoa: z.enum(['CAT', 'BEAR', 'AMBOS']).optional(),
  local: z.enum(['CASA', 'CINEMA']).optional(),
  ano: z.coerce.number().int().min(1888).max(2100).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limite: z.coerce.number().int().optional(),
});

/** `GET /watches` — a tela "Assistidos" (§8). */
export async function getWatches(req: Request, res: Response): Promise<void> {
  const f = lerCorpo(filtros, {
    pessoa: texto(req.query.pessoa),
    local: texto(req.query.local),
    ano: texto(req.query.ano),
    q: texto(req.query.q),
    cursor: texto(req.query.cursor),
    limite: texto(req.query.limite),
  });
  res.json(await listarVisualizacoes(f));
}

/** `PATCH /watches/:id` — edição parcial. */
export async function patchWatch(req: Request, res: Response): Promise<void> {
  const parcial = lerCorpo(esquemaDaVisualizacao.partial(), req.body);
  res.json(await editarVisualizacao(String(req.params.id), parcial));
}

/** `DELETE /watches/:id` — marca como removida (§2). */
export async function deleteWatch(req: Request, res: Response): Promise<void> {
  res.json(await removerVisualizacao(String(req.params.id)));
}
