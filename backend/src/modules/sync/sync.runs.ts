import type { Prisma, SyncJobType, SyncStatus } from '@prisma/client';
import { ConflictError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';

const log = logger.child({ module: 'sync' });

/**
 * Um job que ficou "running" para sempre é um processo que morreu no meio.
 * Sem este limite, um crash travaria aquele tipo de job até alguém mexer no
 * banco à mão.
 */
const MINUTOS_ATE_CONSIDERAR_ABANDONADO = 60;

export interface ContagensDoJob {
  readCount: number;
  newCount: number;
  matchedCount: number;
  reviewCount: number;
  errorCount: number;
}

/**
 * O que um job recebe para trabalhar.
 *
 * O `syncRunId` é passado adiante para os clientes HTTP, e é assim que cada
 * `RawPayload`, `CanaryCheck` e `MatchDecision` fica amarrado à execução que o
 * produziu — o rastro do §6.
 */
export interface ContextoDoJob {
  syncRunId: string;
  contagens: ContagensDoJob;
  detalhes: Record<string, unknown>;
}

export interface ResultadoDaExecucao<T> {
  syncRunId: string;
  status: SyncStatus;
  resultado?: T;
  erro?: unknown;
  duracaoMs: number;
}

/**
 * Envolve um job com o ciclo de vida do `SyncRun` (§9): abre, conta, fecha.
 *
 * Isto existe como invólucro e não como responsabilidade de cada job porque
 * "todo job registra SyncRun" é uma regra que não pode depender de alguém
 * lembrar. Job que lança ainda fecha o registro, com status `failed` e a
 * mensagem — o `/health/sync` precisa conseguir contar a história do que deu
 * errado de madrugada.
 */
export async function executarJob<T>(
  jobType: SyncJobType,
  executar: (ctx: ContextoDoJob) => Promise<T>,
  opcoes: { triggeredBy?: string; permitirConcorrencia?: boolean } = {},
): Promise<ResultadoDaExecucao<T>> {
  if (!opcoes.permitirConcorrencia) {
    await recusarSeJaEstiverRodando(jobType);
  }

  const inicio = Date.now();
  const run = await prisma.syncRun.create({
    data: { jobType, status: 'running', triggeredBy: opcoes.triggeredBy ?? null },
    select: { id: true },
  });

  const ctx: ContextoDoJob = {
    syncRunId: run.id,
    contagens: { readCount: 0, newCount: 0, matchedCount: 0, reviewCount: 0, errorCount: 0 },
    detalhes: {},
  };

  log.info('job iniciado', { jobType, syncRunId: run.id, triggeredBy: opcoes.triggeredBy ?? 'cron' });

  try {
    const resultado = await executar(ctx);

    // erro contado mas não lançado = job terminou, mas não inteiro
    const status: SyncStatus = ctx.contagens.errorCount > 0 ? 'partial' : 'success';

    await fechar(run.id, status, ctx, null);
    const duracaoMs = Date.now() - inicio;

    log.info('job concluído', { jobType, syncRunId: run.id, status, duracaoMs, ...ctx.contagens });

    return { syncRunId: run.id, status, resultado, duracaoMs };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await fechar(run.id, 'failed', ctx, mensagem);

    log.error('job falhou', { jobType, syncRunId: run.id, erro });

    return { syncRunId: run.id, status: 'failed', erro, duracaoMs: Date.now() - inicio };
  }
}

async function recusarSeJaEstiverRodando(jobType: SyncJobType): Promise<void> {
  const limite = new Date(Date.now() - MINUTOS_ATE_CONSIDERAR_ABANDONADO * 60_000);

  const rodando = await prisma.syncRun.findFirst({
    where: { jobType, status: 'running', startedAt: { gte: limite } },
    select: { id: true, startedAt: true },
  });

  if (rodando) {
    throw new ConflictError(
      `O job ${jobType} já está rodando desde ${rodando.startedAt.toISOString()}.`,
      { details: { syncRunId: rodando.id } },
    );
  }

  // execuções antigas presas em "running" são de processos que morreram
  const abandonadas = await prisma.syncRun.updateMany({
    where: { jobType, status: 'running', startedAt: { lt: limite } },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: 'Execução abandonada: o processo terminou sem fechar o registro.',
    },
  });

  if (abandonadas.count > 0) {
    log.warn('execuções abandonadas foram fechadas', { jobType, count: abandonadas.count });
  }
}

async function fechar(
  syncRunId: string,
  status: SyncStatus,
  ctx: ContextoDoJob,
  errorMessage: string | null,
): Promise<void> {
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status,
      finishedAt: new Date(),
      ...ctx.contagens,
      errorMessage,
      details: ctx.detalhes as Prisma.InputJsonValue,
    },
  });
}

/** Último `SyncRun` de cada tipo — alimenta o `/health/sync` (§8). */
export async function ultimasExecucoes(): Promise<
  Array<{
    jobType: SyncJobType;
    status: SyncStatus;
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage: string | null;
    contagens: ContagensDoJob;
  }>
> {
  const linhas = await prisma.$queryRaw<
    Array<{
      job_type: SyncJobType;
      status: SyncStatus;
      started_at: Date;
      finished_at: Date | null;
      error_message: string | null;
      read_count: number;
      new_count: number;
      matched_count: number;
      review_count: number;
      error_count: number;
    }>
  >`
    SELECT DISTINCT ON (job_type)
      job_type, status, started_at, finished_at, error_message,
      read_count, new_count, matched_count, review_count, error_count
    FROM sync_runs
    ORDER BY job_type, started_at DESC
  `;

  return linhas.map((l) => ({
    jobType: l.job_type,
    status: l.status,
    startedAt: l.started_at,
    finishedAt: l.finished_at,
    errorMessage: l.error_message,
    contagens: {
      readCount: l.read_count,
      newCount: l.new_count,
      matchedCount: l.matched_count,
      reviewCount: l.review_count,
      errorCount: l.error_count,
    },
  }));
}
