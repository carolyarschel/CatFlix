import type { Request, Response } from 'express';
import { z } from 'zod';
import { lerCorpo, textoDaQuery } from '../../shared/validacao';
import { pessoaDaRequisicao } from '../users/users.pessoa';
import { adicionarALista, listarLista, restaurarNaLista, tirarDaLista } from './watchlist.service';

/** `GET /watchlist?escopo=CAT|BEAR|AMBOS` — sem escopo, as duas listas. */
export async function getWatchlist(req: Request, res: Response): Promise<void> {
  const { escopo } = lerCorpo(z.object({ escopo: z.enum(['CAT', 'BEAR', 'AMBOS']).optional() }), {
    escopo: textoDaQuery(req.query.escopo),
  });
  res.json(await listarLista(escopo));
}

const corpoDoPut = z.object({
  /** 1–5; `null` apaga as estrelas; ausente não mexe */
  interesse: z.number().int().min(1).max(5).nullable().optional(),
  /** a opção "nós dois" do §4.1: põe na lista das duas pessoas */
  paraOsDois: z.boolean().optional(),
});

/**
 * `PUT /titles/:id/watchlist` — na lista da pessoa logada (§9).
 *
 * Com `paraOsDois`, entra também na lista da outra pessoa, SEM interesse: as
 * estrelas são de cada um, e marcar pelas duas seria escolher pela outra.
 */
export async function putWatchlist(req: Request, res: Response): Promise<void> {
  const corpo = lerCorpo(corpoDoPut, req.body);
  const eu = await pessoaDaRequisicao(req);
  const titleId = String(req.params.id);

  const minha = await adicionarALista(titleId, eu, corpo.interesse);
  const daOutra = corpo.paraOsDois ? await adicionarALista(titleId, eu === 'CAT' ? 'BEAR' : 'CAT') : null;

  res.json({ itens: daOutra ? [minha, daOutra] : [minha] });
}

/** `DELETE /titles/:id/watchlist` — tira só da lista de quem pediu. */
export async function deleteWatchlist(req: Request, res: Response): Promise<void> {
  res.json(await tirarDaLista(String(req.params.id), await pessoaDaRequisicao(req)));
}

/** `POST /watchlist/restaurar` — o "desfazer" do "Removido da sua lista" (§3.3). */
export async function postRestaurar(req: Request, res: Response): Promise<void> {
  const { ids } = lerCorpo(z.object({ ids: z.array(z.string().min(1)).min(1).max(10) }), req.body);
  res.json({ restaurados: await restaurarNaLista(ids) });
}
