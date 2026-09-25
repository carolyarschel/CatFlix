import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import {
  buscarCandidatos,
  confirmar,
  contarFila,
  dispensar,
  listarFila,
  marcarComoNaoFilme,
  mesclar,
  substituir,
} from './review.service';

const motivos = z.enum(['low_confidence', 'no_candidate', 'possible_duplicate', 'probable_non_film']);

/**
 * Quem está resolvendo.
 *
 * Vem do middleware de autenticação (§3, resolvido em 23/09/2026) — exatamente
 * como este comentário previa quando ainda lia um cabeçalho. Nenhuma outra
 * linha deste arquivo mudou, que era o ponto de isolar a estratégia.
 */
function perfilDe(req: Request): string | undefined {
  return req.perfil;
}

/**
 * O Express 5 tipa `params` como `string | string[]` — uma rota pode repetir
 * o mesmo nome. Aqui nunca repete, mas deixar o tipo frouxo passar adiante
 * transformaria um id inesperado em `"a,b"` silenciosamente.
 */
function idDaRota(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('Id da pendência ausente ou inválido.');
  }
  return id;
}

export async function getFila(req: Request, res: Response): Promise<void> {
  const filtro = req.query.motivo;
  const motivo = typeof filtro === 'string' ? motivos.safeParse(filtro) : null;

  if (motivo && !motivo.success) {
    throw new ValidationError(`Motivo desconhecido: "${String(filtro)}".`, {
      details: { validos: motivos.options },
    });
  }

  res.json(await listarFila(motivo?.success ? { motivo: motivo.data } : {}));
}

/** Só o número, para a badge da navegação. */
export async function getContagem(_req: Request, res: Response): Promise<void> {
  res.json({ total: await contarFila() });
}

export async function postConfirmar(req: Request, res: Response): Promise<void> {
  res.json(await confirmar(idDaRota(req), perfilDe(req)));
}

const corpoDeSubstituicao = z.object({ tmdbId: z.number().int().positive() });

export async function postSubstituir(req: Request, res: Response): Promise<void> {
  const corpo = corpoDeSubstituicao.safeParse(req.body);
  if (!corpo.success) {
    throw new ValidationError('Informe o tmdbId do filme correto.', { details: corpo.error.issues });
  }
  res.json(await substituir(idDaRota(req), corpo.data.tmdbId, perfilDe(req)));
}

export async function postNaoEhFilme(req: Request, res: Response): Promise<void> {
  res.json(await marcarComoNaoFilme(idDaRota(req), perfilDe(req)));
}

const corpoDeMerge = z.object({ toTitleId: z.string().min(1) });

export async function postMesclar(req: Request, res: Response): Promise<void> {
  const corpo = corpoDeMerge.safeParse(req.body);
  if (!corpo.success) {
    throw new ValidationError('Informe o toTitleId do filme com que unir.', {
      details: corpo.error.issues,
    });
  }
  res.json(await mesclar(idDaRota(req), corpo.data.toTitleId, perfilDe(req)));
}

export async function postDispensar(req: Request, res: Response): Promise<void> {
  res.json(await dispensar(idDaRota(req), perfilDe(req)));
}

/** Alimenta a tela de "trocar": busca no TMDB por título. */
export async function getBusca(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const ano = typeof req.query.ano === 'string' ? Number(req.query.ano) : null;

  res.json({ resultados: await buscarCandidatos(q, Number.isFinite(ano) ? ano : null) });
}
