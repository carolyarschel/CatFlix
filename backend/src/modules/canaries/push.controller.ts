import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import { perfilDaRequisicao } from '../users/users.middleware';
import { alertasAbertos } from './alerts';
import {
  chavePublica,
  desinscrever,
  inscrever,
  inscricaoSchema,
  inscricoesVivas,
  pushConfigurado,
} from './push.service';

/**
 * `GET /api/push/chave` — a chave pública VAPID que o service worker precisa
 * para criar a inscrição. É pública por definição: vai para o navegador.
 */
export async function chaveDePush(_req: Request, res: Response): Promise<void> {
  res.json({
    habilitado: pushConfigurado(),
    chavePublica: chavePublica(),
    dispositivosInscritos: await inscricoesVivas(),
  });
}

/** `POST /api/push/inscrever` — chamado pelo PWA depois de a pessoa aceitar. */
export async function inscreverDispositivo(req: Request, res: Response): Promise<void> {
  const corpo = inscricaoSchema.safeParse(req.body);
  if (!corpo.success) {
    throw new ValidationError('Inscrição de push inválida.', { details: corpo.error.issues });
  }

  // O dono da inscrição vem da SESSÃO, não de um header do cliente.
  //
  // Antes vinha de `x-profile`, que o navegador escolhe: qualquer um logado
  // podia inscrever o celular dele no nome do outro perfil e passar a receber
  // os alertas da outra pessoa. É o mesmo princípio do §3 sobre o `?user=`,
  // que só vale quando bate com o perfil da sessão.
  const perfil = perfilDaRequisicao(req);
  const userAgent = req.headers['user-agent'];

  const r = await inscrever(corpo.data, {
    userId: perfil,
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  });

  res.status(r.nova ? 201 : 200).json({ inscrito: true, nova: r.nova });
}

const desinscricaoSchema = z.object({ endpoint: z.string().min(1) });

/** `POST /api/push/desinscrever` — a pessoa desligou as notificações. */
export async function desinscreverDispositivo(req: Request, res: Response): Promise<void> {
  const corpo = desinscricaoSchema.safeParse(req.body);
  if (!corpo.success) {
    throw new ValidationError('Informe o endpoint da inscrição.', { details: corpo.error.issues });
  }

  const removido = await desinscrever(corpo.data.endpoint);
  res.json({ removido });
}

/** `GET /api/alertas` — o que o app mostra de pendência operacional. */
export async function listarAlertas(_req: Request, res: Response): Promise<void> {
  res.json({ alertas: await alertasAbertos() });
}
