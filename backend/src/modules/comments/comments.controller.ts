import type { Request, Response } from 'express';
import { z } from 'zod';
import { lerCorpo } from '../../shared/validacao';
import { pessoaDaRequisicao } from '../users/users.pessoa';
import { definirComentario, removerComentario } from './comments.service';

/**
 * `PUT /titles/:id/comment { texto }` — o comentário de quem está logado.
 * Texto vazio apaga, e a resposta é `{ comentario: null }`.
 */
export async function putComentario(req: Request, res: Response): Promise<void> {
  const { texto } = lerCorpo(z.object({ texto: z.string() }), req.body);
  const comentario = await definirComentario(String(req.params.id), await pessoaDaRequisicao(req), texto);
  res.json({ comentario });
}

/** `DELETE /titles/:id/comment` — apaga só o de quem pediu. */
export async function deleteComentario(req: Request, res: Response): Promise<void> {
  res.json(await removerComentario(String(req.params.id), await pessoaDaRequisicao(req)));
}
