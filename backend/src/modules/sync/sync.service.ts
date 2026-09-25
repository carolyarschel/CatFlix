import type { SyncJobType } from '@prisma/client';
import { ValidationError } from '../../shared/errors';
import {
  jobMetadataTmdb,
  jobNotasOmdb,
  jobProximosLancamentos,
  jobSessoes,
  jobTags,
} from './sync.jobs';
import { executarJob, type ContextoDoJob, type ResultadoDaExecucao } from './sync.runs';

/**
 * Catálogo de jobs.
 *
 * Um mapa, e não um `switch`, para que o disparo manual (§10, `POST
 * /sync/run`) e o cron usem exatamente o mesmo caminho — um job que só o cron
 * sabe rodar é um job que ninguém consegue depurar às onze da noite.
 */
const JOBS: Record<string, { jobType: SyncJobType; executar: (ctx: ContextoDoJob) => Promise<void>; descricao: string }> = {
  sessoes: {
    jobType: 'ingresso_sessions',
    executar: jobSessoes,
    descricao: 'Cinemas, sessões, matching, catálogo, disponibilidade e tags',
  },
  proximos: {
    jobType: 'ingresso_upcoming',
    executar: jobProximosLancamentos,
    descricao: 'Pré-estreias e em breve',
  },
  metadata: {
    jobType: 'tmdb_metadata',
    executar: jobMetadataTmdb,
    descricao: 'Refresh de metadata do TMDB vencida (30 dias)',
  },
  notas: {
    jobType: 'omdb_ratings',
    executar: jobNotasOmdb,
    descricao: 'Notas IMDb e Rotten Tomatoes',
  },
  tags: {
    jobType: 'tags_rebuild',
    executar: jobTags,
    descricao: 'Recalcular facetas automáticas',
  },
};

export type NomeDoJob = keyof typeof JOBS;

export function jobsDisponiveis(): Array<{ nome: string; jobType: SyncJobType; descricao: string }> {
  return Object.entries(JOBS).map(([nome, j]) => ({
    nome,
    jobType: j.jobType,
    descricao: j.descricao,
  }));
}

export async function rodarJob(
  nome: string,
  opcoes: { triggeredBy?: string } = {},
): Promise<ResultadoDaExecucao<void>> {
  const job = JOBS[nome];

  if (!job) {
    throw new ValidationError(`Job desconhecido: "${nome}".`, {
      details: { disponiveis: Object.keys(JOBS) },
    });
  }

  return executarJob(job.jobType, job.executar, opcoes);
}

/**
 * O "Sincronizar agora" do app (§9).
 *
 * Roda a sequência completa na ordem certa: sessões primeiro (é o que traz
 * título novo), depois próximos lançamentos, e só então metadata e notas —
 * que dependem dos títulos existirem.
 *
 * Um job que falha não impede os seguintes: o resultado devolve o status de
 * cada um, e o `/health/sync` conta a história.
 */
export async function rodarTudo(
  opcoes: { triggeredBy?: string } = {},
): Promise<Array<{ nome: string; status: string; syncRunId: string; duracaoMs: number }>> {
  const ordem: string[] = ['sessoes', 'proximos', 'metadata', 'notas'];
  const resultados = [];

  for (const nome of ordem) {
    const r = await rodarJob(nome, opcoes);
    resultados.push({ nome, status: r.status, syncRunId: r.syncRunId, duracaoMs: r.duracaoMs });
  }

  return resultados;
}
