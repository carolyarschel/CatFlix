import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { alertasAbertos, ultimasChecagens } from '../canaries';
import { idadeDosDadosEmHoras } from '../cinemas';
import { agendaAtual } from './sync.scheduler';
import { jobsDisponiveis, rodarJob, rodarTudo } from './sync.service';
import { ultimasExecucoes } from './sync.runs';

const log = logger.child({ module: 'sync:http' });

const corpoDoDisparo = z.object({
  /** nome do job; ausente = a sequência completa */
  job: z.string().optional(),
  /** aguarda o fim em vez de responder 202 — útil no terminal, não na UI */
  aguardar: z.boolean().optional(),
});

/**
 * `POST /api/sync/run` — o "Sincronizar agora" do app (§9).
 *
 * Por padrão responde **202 na hora** e deixa o job rodando: um sync completo
 * leva minutos, e uma requisição HTTP pendurada todo esse tempo morre no
 * proxy antes de terminar. Quem quer o resultado consulta `/api/health/sync`.
 */
export async function dispararSync(req: Request, res: Response): Promise<void> {
  const corpo = corpoDoDisparo.safeParse(req.body ?? {});
  if (!corpo.success) {
    throw new ValidationError('Corpo inválido para o disparo de sync.', {
      details: corpo.error.issues,
    });
  }

  const { job, aguardar } = corpo.data;
  // quem disparou: por ora o perfil vem do cabeçalho. Quando a autenticação
  // dos dois perfis for decidida (§3, [EM ABERTO]), isto passa a vir do
  // middleware, sem mexer no resto.
  const triggeredBy = typeof req.headers['x-profile'] === 'string' ? req.headers['x-profile'] : undefined;

  if (aguardar) {
    const resultado = job
      ? [await rodarJob(job, triggeredBy ? { triggeredBy } : {})].map((r) => ({
          nome: job,
          status: r.status,
          syncRunId: r.syncRunId,
          duracaoMs: r.duracaoMs,
        }))
      : await rodarTudo(triggeredBy ? { triggeredBy } : {});

    res.status(200).json({ aguardou: true, execucoes: resultado });
    return;
  }

  // valida o nome ANTES de responder 202, senão o erro some no background
  if (job && !jobsDisponiveis().some((j) => j.nome === job)) {
    throw new ValidationError(`Job desconhecido: "${job}".`, {
      details: { disponiveis: jobsDisponiveis().map((j) => j.nome) },
    });
  }

  const promessa = job ? rodarJob(job, triggeredBy ? { triggeredBy } : {}) : rodarTudo(triggeredBy ? { triggeredBy } : {});

  promessa.catch((erro: unknown) => {
    // o SyncRun já registrou o que deu errado; este log é para o caso de a
    // falha ser ANTES do registro abrir (ex.: já havia um sync rodando)
    log.warn('disparo manual não completou', { job: job ?? 'tudo', erro });
  });

  res.status(202).json({
    aceito: true,
    job: job ?? 'tudo',
    mensagem: 'Sincronização iniciada. Acompanhe em GET /api/health/sync.',
  });
}

/** `GET /api/sync/jobs` — o que dá para disparar. */
export function listarJobs(_req: Request, res: Response): void {
  res.json({ jobs: jobsDisponiveis(), agenda: agendaAtual() });
}

/**
 * `GET /api/health/sync` (§8) — estado do último sync, dos canaries e do modo
 * degradado.
 */
export async function healthDoSync(_req: Request, res: Response): Promise<void> {
  const [execucoes, idadeHoras, pendencias, contagens, checagens, alertas] = await Promise.all([
    ultimasExecucoes(),
    idadeDosDadosEmHoras(),
    prisma.reviewItem.count({ where: { status: 'open' } }),
    Promise.all([
      prisma.title.count({ where: { status: 'matched' } }),
      prisma.title.count({ where: { status: 'orphan' } }),
      prisma.session.count({ where: { active: true } }),
      prisma.cinema.count({ where: { active: true } }),
    ]),
    ultimasChecagens(),
    alertasAbertos(),
  ]);

  const [titulos, orfaos, sessoes, cinemas] = contagens;

  // modo degradado (§8): o app continua servindo o cache e avisa a idade dele
  const degradado = idadeHoras !== null && idadeHoras > env.DEGRADED_AFTER_HOURS;
  const algumFalhou = execucoes.some((e) => e.status === 'failed');
  const canaryCritico = alertas.some((a) => a.severity === 'critical');

  const status = canaryCritico ? 'critico' : degradado || algumFalhou || alertas.length > 0 ? 'degradado' : 'ok';

  res.status(200).json({
    status,
    degradado: {
      ativo: degradado,
      idadeDosDadosEmHoras: idadeHoras === null ? null : Number(idadeHoras.toFixed(2)),
      limiteEmHoras: env.DEGRADED_AFTER_HOURS,
      aviso: degradado ? `dados de ${Math.round(idadeHoras)} horas atrás` : null,
    },
    execucoes: execucoes.map((e) => ({
      job: e.jobType,
      status: e.status,
      inicio: e.startedAt,
      fim: e.finishedAt,
      erro: e.errorMessage,
      contagens: e.contagens,
    })),
    canaries: checagens.map((c) => ({
      camada: c.layer,
      alvo: c.target,
      passou: c.passed,
      medido: c.measuredValue,
      limiar: c.threshold,
      mensagem: c.message,
      em: c.checkedAt,
    })),
    alertas: alertas.map((a) => ({
      severidade: a.severity,
      mensagem: a.message,
      fingerprint: a.fingerprint,
      desde: a.createdAt,
      // sem `enviadoEm`, nenhum canal entregou. `avisadoPor` diz QUAIS
      // entregaram: só "log" significa que o push NÃO chegou ao celular.
      enviadoEm: a.sentAt,
      avisadoPor: a.notifier,
    })),
    catalogo: { titulos, orfaos, sessoes, cinemas, pendenciasDeRevisao: pendencias },
  });
}
