import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import { lerCorpo, textoDaQuery } from '../../shared/validacao';
import { pessoaDaRequisicao } from '../users/users.pessoa';
import { removerNota } from '../ratings';
import { esquemaDaVisualizacao } from '../watches/watches.controller';
import { buscarParaAdicionar } from './library.busca';
import {
  adicionarPorTmdbId,
  darNota,
  definirJustwatchUrl,
  detalheDoAcervo,
  registrarQueAssistimos,
  removerDoCatalogo,
  restaurarNoCatalogo,
} from './library.service';

const idDaRota = (req: Request): string => String(req.params.id);

/** `GET /tmdb/search?q=` — a busca do "+". A chave do TMDB nunca vai ao navegador. */
export async function getBusca(req: Request, res: Response): Promise<void> {
  const q = textoDaQuery(req.query.q)?.trim();
  if (!q || q.length < 2) {
    throw new ValidationError('Digite pelo menos 2 letras para buscar.');
  }
  res.json({ itens: await buscarParaAdicionar(q) });
}

/** `POST /library/titles { tmdbId }` — cria ou reaproveita, nunca duplica. */
export async function postTitulo(req: Request, res: Response): Promise<void> {
  const { tmdbId } = lerCorpo(z.object({ tmdbId: z.number().int().positive() }), req.body);
  const resultado = await adicionarPorTmdbId(tmdbId);
  res.status(resultado.criado ? 201 : 200).json(resultado);
}

/** `GET /library/titles/:id` — o detalhe do §7. */
export async function getTitulo(req: Request, res: Response): Promise<void> {
  res.json(await detalheDoAcervo(idDaRota(req), await pessoaDaRequisicao(req)));
}

/**
 * `PATCH /library/titles/:id { justwatchUrl }`.
 *
 * As tags manuais (§7.2: "De bisnaguinha", "De crédito") já têm rotas
 * próprias — `POST /titles/:id/tags` e `DELETE /titles/:id/tags/:tagId` —, com
 * a regra de que cada pessoa só remove as suas. Duplicá-las aqui abriria um
 * segundo caminho sem essa regra.
 */
export async function patchTitulo(req: Request, res: Response): Promise<void> {
  const { justwatchUrl } = lerCorpo(
    z.object({ justwatchUrl: z.string().max(500).nullable() }),
    req.body,
  );
  res.json({ justwatchUrl: await definirJustwatchUrl(idDaRota(req), justwatchUrl) });
}

/** `DELETE /library/titles/:id` — "Remover do catálogo" (§4.4). */
export async function deleteTitulo(req: Request, res: Response): Promise<void> {
  res.json(await removerDoCatalogo(idDaRota(req)));
}

/** `POST /library/titles/:id/restaurar { removidoEm }` — o desfazer do §4.4. */
export async function postRestaurarTitulo(req: Request, res: Response): Promise<void> {
  const { removidoEm } = lerCorpo(z.object({ removidoEm: z.iso.datetime() }), req.body);
  res.json(await restaurarNoCatalogo(idDaRota(req), new Date(removidoEm)));
}

/** `POST /titles/:id/watches` — "Já assistimos"; tira da lista de quem estava. */
export async function postVisualizacao(req: Request, res: Response): Promise<void> {
  const dados = lerCorpo(esquemaDaVisualizacao, req.body);
  res.status(201).json(await registrarQueAssistimos(idDaRota(req), dados));
}

/** `PUT /titles/:id/rating { nota }` — da pessoa logada, e só se ela assistiu. */
export async function putNota(req: Request, res: Response): Promise<void> {
  const { nota } = lerCorpo(z.object({ nota: z.number().min(0).max(10) }), req.body);
  res.json(await darNota(idDaRota(req), await pessoaDaRequisicao(req), nota));
}

/** `DELETE /titles/:id/rating` — tira a nota da pessoa logada. */
export async function deleteNota(req: Request, res: Response): Promise<void> {
  res.json(await removerNota(idDaRota(req), await pessoaDaRequisicao(req)));
}
