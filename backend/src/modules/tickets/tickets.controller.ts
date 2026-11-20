import type { Request, Response } from 'express';
import { z } from 'zod';
import { lerCorpo } from '../../shared/validacao';
import { pessoaDaRequisicao } from '../users/users.pessoa';
import {
  cadastrarIngresso,
  editarIngresso,
  ingressosAtivos,
  ingressosDoTitulo,
  marcarComoAssistido,
  removerIngresso,
} from './tickets.service';

const codigos = z.array(z.string()).max(50);

/** `GET /tickets` — todos os ingressos que ainda servem: o carrossel da aba Cinema. */
export async function getIngressosAtivos(_req: Request, res: Response): Promise<void> {
  res.json({ itens: await ingressosAtivos() });
}

/** `GET /titles/:id/tickets` — os ingressos do filme que ainda servem. */
export async function getIngressos(req: Request, res: Response): Promise<void> {
  res.json({ itens: await ingressosDoTitulo(String(req.params.id)) });
}

/** `POST /titles/:id/tickets { sessaoId, codigos }` */
export async function postIngresso(req: Request, res: Response): Promise<void> {
  const corpo = lerCorpo(z.object({ sessaoId: z.string().min(1), codigos }), req.body);
  const ingresso = await cadastrarIngresso(String(req.params.id), await pessoaDaRequisicao(req), corpo);
  res.status(201).json({ ingresso });
}

/** `PATCH /tickets/:id { sessaoId?, codigos? }` */
export async function patchIngresso(req: Request, res: Response): Promise<void> {
  const corpo = lerCorpo(z.object({ sessaoId: z.string().min(1).optional(), codigos: codigos.optional() }), req.body);
  res.json({ ingresso: await editarIngresso(String(req.params.id), corpo) });
}

/** `DELETE /tickets/:id` */
export async function deleteIngresso(req: Request, res: Response): Promise<void> {
  await removerIngresso(String(req.params.id));
  res.status(204).end();
}

/**
 * `POST /tickets/:id/assistido` — registra a visualização dos dois, no cinema,
 * na data da sessão. A resposta é a mesma do registro normal, para a tela
 * oferecer o desfazer da lista.
 */
export async function postAssistido(req: Request, res: Response): Promise<void> {
  res.status(201).json(await marcarComoAssistido(String(req.params.id)));
}
