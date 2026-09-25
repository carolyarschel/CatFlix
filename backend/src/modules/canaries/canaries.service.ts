import { Prisma } from '@prisma/client';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { TransportEvent } from '../../shared/http';
import { registrarChecagem } from './alerts';

const log = logger.child({ module: 'canaries' });

/**
 * As quatro camadas do §8. Cada uma grava `CanaryCheck`.
 *
 * A ordem não é acidental: elas vão do mais concreto ao mais sutil. Transporte
 * pega "a API caiu"; contrato pega "a API mudou de formato"; semântico pega "a
 * API responde bem mas o conteúdo encolheu"; matching pega "o conteúdo está lá
 * mas parou de casar". Um problema real costuma acender só uma delas, e saber
 * QUAL acendeu já é metade do diagnóstico.
 */

// ── §8.1 Transporte ──────────────────────────────────────────

/** Quantos 403 seguidos até tratar como bloqueio, e não como soluço. */
const FORBIDDEN_ATE_BLOQUEIO = 3;

/**
 * Observa o transporte a partir dos eventos que o `HttpClient` emite.
 *
 * É um acumulador de execução: um 403 isolado é ruído, três seguidos é
 * bloqueio. Por isso a checagem só é gravada no fim do job, com o resumo.
 */
export class ObservadorDeTransporte {
  private readonly porFonte = new Map<
    string,
    { total: number; ok: number; forbidden: number; rateLimited: number; erros: number; timeouts: number }
  >();

  constructor(private readonly syncRunId?: string) {}

  /** Ligado ao `onTransportEvent` dos clientes. */
  observar(evento: TransportEvent): void {
    const atual = this.porFonte.get(evento.source) ?? {
      total: 0,
      ok: 0,
      forbidden: 0,
      rateLimited: 0,
      erros: 0,
      timeouts: 0,
    };

    atual.total += 1;
    if (evento.outcome === 'ok') atual.ok += 1;
    if (evento.outcome === 'forbidden') atual.forbidden += 1;
    if (evento.outcome === 'rate_limited') atual.rateLimited += 1;
    if (evento.outcome === 'http_error' || evento.outcome === 'network_error') atual.erros += 1;
    if (evento.outcome === 'timeout') atual.timeouts += 1;

    this.porFonte.set(evento.source, atual);
  }

  async registrar(): Promise<void> {
    for (const [fonte, c] of this.porFonte) {
      // 403 persistente é bloqueio: severidade alta (§8)
      const bloqueado = c.forbidden >= FORBIDDEN_ATE_BLOQUEIO;
      const taxaDeErro = c.total === 0 ? 0 : (c.total - c.ok) / c.total;
      const passou = !bloqueado && taxaDeErro < 0.5;

      await registrarChecagem({
        layer: 'transport',
        target: `${fonte}:http`,
        passed: passou,
        measuredValue: Number(taxaDeErro.toFixed(3)),
        threshold: 0.5,
        severity: bloqueado ? 'critical' : 'warning',
        message: bloqueado
          ? `${fonte}: ${c.forbidden} respostas 403 — parece bloqueio, não instabilidade.`
          : passou
            ? undefined
            : `${fonte}: ${Math.round(taxaDeErro * 100)}% das requisições falharam.`,
        details: { ...c },
        ...(this.syncRunId ? { syncRunId: this.syncRunId } : {}),
      });
    }
  }
}

// ── §8.2 Contrato ────────────────────────────────────────────

/**
 * Chamado quando um payload não bate com o schema `zod`.
 *
 * Severidade alta sempre: contrato quebrado significa que o catálogo PAROU de
 * ser atualizado por aquela fonte (§7.1), e isso não melhora sozinho.
 */
export async function registrarQuebraDeContrato(
  source: string,
  endpoint: string,
  detalhes: { rawPayloadId?: string; issues?: unknown; mensagem: string },
  syncRunId?: string,
): Promise<void> {
  await registrarChecagem({
    layer: 'contract',
    target: `${source}:${endpoint}`,
    passed: false,
    severity: 'critical',
    message: detalhes.mensagem,
    details: {
      rawPayloadId: detalhes.rawPayloadId,
      issues: detalhes.issues,
      dica: 'O RawPayload guardado permite reprocessar sem rechamar a API.',
    },
    ...(syncRunId ? { syncRunId } : {}),
  });
}

export async function registrarContratoOk(
  source: string,
  endpoint: string,
  syncRunId?: string,
): Promise<void> {
  await registrarChecagem({
    layer: 'contract',
    target: `${source}:${endpoint}`,
    passed: true,
    ...(syncRunId ? { syncRunId } : {}),
  });
}

// ── §8.3 Semântico ───────────────────────────────────────────

/** Queda aceitável no volume de eventos antes de desconfiar (§8). */
const QUEDA_MAXIMA = 0.4;
const DIAS_DA_MEDIA_MOVEL = 7;

export interface EstadoSemantico {
  eventosLidos: number;
  preEstreias: number;
  cinemasVistos: string[];
}

/**
 * Compara o que este sync viu com a média móvel de 7 dias.
 *
 * ⚠️ A média vem dos `SyncRun` anteriores, NÃO do `count` de uma resposta: o
 * `count` do ingresso é o tamanho da página, não o total (CONTRATO.md §4.4), e
 * usá-lo como baseline compararia coisas diferentes.
 */
export async function checarSemantica(
  estado: EstadoSemantico,
  syncRunId?: string,
): Promise<void> {
  const desde = new Date(Date.now() - DIAS_DA_MEDIA_MOVEL * 86_400_000);

  const anteriores = await prisma.syncRun.findMany({
    where: {
      jobType: 'ingresso_sessions',
      status: { in: ['success', 'partial'] },
      startedAt: { gte: desde },
      readCount: { gt: 0 },
      ...(syncRunId ? { id: { not: syncRunId } } : {}),
    },
    select: { readCount: true },
  });

  // sem histórico não há do que desconfiar: a primeira execução é o baseline
  if (anteriores.length === 0) {
    await registrarChecagem({
      layer: 'semantic',
      target: 'ingresso:volume_de_eventos',
      passed: true,
      measuredValue: estado.eventosLidos,
      message: 'Sem histórico suficiente ainda; esta execução vira baseline.',
      ...(syncRunId ? { syncRunId } : {}),
    });
  } else {
    const media = anteriores.reduce((s, r) => s + r.readCount, 0) / anteriores.length;
    const queda = media === 0 ? 0 : (media - estado.eventosLidos) / media;

    await registrarChecagem({
      layer: 'semantic',
      target: 'ingresso:volume_de_eventos',
      passed: queda <= QUEDA_MAXIMA,
      measuredValue: estado.eventosLidos,
      threshold: Math.round(media * (1 - QUEDA_MAXIMA)),
      severity: 'warning',
      message:
        queda > QUEDA_MAXIMA
          ? `Eventos caíram ${Math.round(queda * 100)}%: ${estado.eventosLidos} contra média de ${media.toFixed(1)} em ${DIAS_DA_MEDIA_MOVEL} dias.`
          : undefined,
      details: { media, amostras: anteriores.length, queda },
      ...(syncRunId ? { syncRunId } : {}),
    });
  }

  // cinema que sempre aparece e sumiu (§8)
  const conhecidos = await prisma.cinema.findMany({
    where: { active: true },
    select: { ingressoId: true, name: true },
  });

  const vistos = new Set(estado.cinemasVistos);
  const sumidos = conhecidos.filter((c) => !vistos.has(c.ingressoId));

  await registrarChecagem({
    layer: 'semantic',
    target: 'ingresso:cinemas_presentes',
    passed: sumidos.length === 0,
    measuredValue: estado.cinemasVistos.length,
    threshold: conhecidos.length,
    severity: 'warning',
    message:
      sumidos.length > 0
        ? `Cinema(s) que sempre aparecem sumiram: ${sumidos.map((c) => c.name).join(', ')}.`
        : undefined,
    details: { sumidos: sumidos.map((c) => c.ingressoId) },
    ...(syncRunId ? { syncRunId } : {}),
  });
}

/** Zero pré-estreias num período onde sempre há (§8). */
export async function checarPreEstreias(quantidade: number, syncRunId?: string): Promise<void> {
  const desde = new Date(Date.now() - 30 * 86_400_000);

  const historico = await prisma.syncRun.findMany({
    where: { jobType: 'ingresso_upcoming', status: 'success', startedAt: { gte: desde } },
    select: { details: true },
  });

  const jaTeve = historico.some((h) => {
    const d = h.details as { pre_estreia?: { eventos?: number } } | null;
    return (d?.pre_estreia?.eventos ?? 0) > 0;
  });

  await registrarChecagem({
    layer: 'semantic',
    target: 'ingresso:pre_estreias',
    passed: quantidade > 0 || !jaTeve,
    measuredValue: quantidade,
    threshold: 1,
    severity: 'warning',
    message:
      quantidade === 0 && jaTeve
        ? 'Zero pré-estreias, mas houve pré-estreia nos últimos 30 dias. Suspeito.'
        : undefined,
    ...(syncRunId ? { syncRunId } : {}),
  });
}

// ── §8.4 Matching ────────────────────────────────────────────

/** Abaixo disto, algo mudou no formato dos títulos do ingresso. */
const QUEDA_MAXIMA_DE_MATCH = 0.25;

/**
 * Taxa de auto-match contra o baseline histórico (§8).
 *
 * É o canary que pega **mudança silenciosa no formato dos títulos**: a API
 * responde 200, o payload bate com o schema, o volume está normal — e de
 * repente nada casa porque começaram a mandar "DUNA - PARTE 2 [IMAX]" em vez
 * de "DUNA PARTE 2 - IMAX".
 */
export async function checarTaxaDeMatch(syncRunId?: string): Promise<void> {
  const decisoesDoRun = syncRunId
    ? await prisma.matchDecision.findMany({
        where: { syncRunId, stage: { not: 'cache' } },
        select: { outcome: true },
      })
    : [];

  // só decisões NOVAS contam: um sync que resolveu tudo pelo cache não diz
  // nada sobre a qualidade do matching
  if (decisoesDoRun.length < 5) {
    log.debug('poucas decisões novas para avaliar a taxa de match', { n: decisoesDoRun.length });
    return;
  }

  const aceitos = decisoesDoRun.filter((d) => d.outcome === 'accepted').length;
  const taxa = aceitos / decisoesDoRun.length;

  const desde = new Date(Date.now() - 30 * 86_400_000);
  const baseline = await prisma.$queryRaw<Array<{ taxa: number | null }>>`
    SELECT avg(CASE WHEN outcome = 'accepted' THEN 1.0 ELSE 0.0 END)::float8 AS taxa
    FROM match_decisions
    WHERE decided_at >= ${desde}
      AND stage <> 'cache'
      ${syncRunId ? Prisma.sql`AND (sync_run_id IS NULL OR sync_run_id <> ${syncRunId})` : Prisma.empty}
  `;

  const referencia = baseline[0]?.taxa ?? null;
  const limite = referencia === null ? null : referencia - QUEDA_MAXIMA_DE_MATCH;
  const passou = limite === null || taxa >= limite;

  await registrarChecagem({
    layer: 'matching',
    target: 'matching:taxa_de_auto_match',
    passed: passou,
    measuredValue: Number(taxa.toFixed(3)),
    threshold: limite === null ? null : Number(limite.toFixed(3)),
    severity: 'warning',
    message: passou
      ? undefined
      : `Auto-match caiu para ${Math.round(taxa * 100)}%, contra baseline de ${Math.round((referencia ?? 0) * 100)}%. Suspeitar de mudança no formato dos títulos.`,
    details: { decisoes: decisoesDoRun.length, aceitos, baseline: referencia },
    ...(syncRunId ? { syncRunId } : {}),
  });
}
