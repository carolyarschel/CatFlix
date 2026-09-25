import type { Prisma } from '@prisma/client';
import { matchThresholds, normalizerConfig } from '../../config/matching';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { decidir } from './matching.engine';
import { FontesDeProducao } from './matching.sources';
import type { DecisaoDeMatching, EventoParaMatching, FontesDeMatching } from './matching.types';

const log = logger.child({ module: 'matching' });

export interface OpcoesDoMatching {
  syncRunId?: string;
  /** injetável para teste; por padrão usa Postgres + TMDB */
  fontes?: FontesDeMatching;
}

/**
 * Decide e **grava o rastro**.
 *
 * Critério de aceite nº 3 do projeto: toda decisão de matching tem um
 * `MatchDecision` correspondente. Por isso a gravação mora aqui e não no
 * chamador — não dá para esquecer.
 *
 * O que este serviço NÃO faz, de propósito: criar `Title`, ligar
 * `TitleExternalId` ou abrir `ReviewItem`. Isso é do `catalog` (passo 6) e do
 * `review` (passo 9); o `sync` (passo 7) é quem costura. O matching decide e
 * registra — é só isso que ele sabe fazer.
 */
export async function decidirERegistrar(
  evento: EventoParaMatching,
  opcoes: OpcoesDoMatching = {},
): Promise<{ decisao: DecisaoDeMatching; matchDecisionId: string }> {
  const fontes = opcoes.fontes ?? new FontesDeProducao(opcoes.syncRunId ? { syncRunId: opcoes.syncRunId } : {});

  const decisao = await decidir(evento, fontes);
  const matchDecisionId = await registrar(evento, decisao, opcoes.syncRunId);

  log.info('decisão de matching', {
    evento: evento.ingressoEventId,
    titulo: evento.title,
    stage: decisao.stage,
    outcome: decisao.outcome,
    score: decisao.score?.total,
  });

  return { decisao, matchDecisionId };
}

async function registrar(
  evento: EventoParaMatching,
  decisao: DecisaoDeMatching,
  syncRunId?: string,
): Promise<string> {
  const c = decisao.score?.componentes;

  const detalhes = {
    normalizerVersion: decisao.normalizerVersion,
    componentesIgnorados: decisao.score?.ignorados ?? [],
    componentes: c
      ? Object.fromEntries(
          Object.entries(c).map(([nome, valor]) => [
            nome,
            { valor: valor.valor, peso: valor.peso, detalhe: valor.detalhe },
          ]),
        )
      : {},
    triagem: decisao.triagem
      ? { suspeita: decisao.triagem.suspeita, sinais: decisao.triagem.sinais }
      : null,
    limiares: { auto: matchThresholds.auto, review: matchThresholds.review },
    configuracao: normalizerConfig.version,
    // o Prisma exige InputJsonValue; as interfaces do domínio não têm index
    // signature, então a conversão é explícita aqui e em um lugar só
  } as unknown as Prisma.InputJsonValue;

  const registro = await prisma.matchDecision.create({
    data: {
      ingressoEventId: evento.ingressoEventId,
      ingressoTitle: evento.title,
      ingressoYear: evento.year,
      normalizedQuery: decisao.normalizedQuery,
      stage: decisao.stage,
      outcome: decisao.outcome,
      candidateTmdbId: decisao.candidateTmdbId ?? null,
      candidateLabel: decisao.candidateLabel ?? null,
      candidateTitleId: decisao.titleId ?? null,
      resultTitleId: decisao.outcome === 'accepted' ? (decisao.titleId ?? null) : null,
      scoreTotal: decisao.score?.total ?? null,
      scoreTitle: c?.title?.valor ?? null,
      scoreRuntime: c?.runtime?.valor ?? null,
      scoreYear: c?.year?.valor ?? null,
      scoreCredits: c?.credits?.valor ?? null,
      thresholdUsed: matchThresholds.auto,
      reason: decisao.reason,
      details: detalhes,
      syncRunId: syncRunId ?? null,
    },
    select: { id: true },
  });

  return registro.id;
}

/**
 * Taxa de auto-match de uma janela — alimenta o canary de MATCHING (§8), que é
 * o que pega mudança silenciosa no formato dos títulos do ingresso.
 */
export async function taxaDeAutoMatch(desde: Date): Promise<{
  total: number;
  aceitos: number;
  taxa: number;
}> {
  const [total, aceitos] = await Promise.all([
    prisma.matchDecision.count({ where: { decidedAt: { gte: desde } } }),
    prisma.matchDecision.count({ where: { decidedAt: { gte: desde }, outcome: 'accepted' } }),
  ]);

  return { total, aceitos, taxa: total === 0 ? 0 : aceitos / total };
}
