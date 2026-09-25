import type { AlertSeverity, CanaryLayer, Prisma } from '@prisma/client';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { notifierPadrao, type Notifier } from './notifier';

const log = logger.child({ module: 'canaries' });

export interface RegistroDeChecagem {
  layer: CanaryLayer;
  /** o que foi checado: "ingresso:/sessions", "matching:auto_rate" */
  target: string;
  passed: boolean;
  measuredValue?: number | null;
  threshold?: number | null;
  message?: string;
  details?: Record<string, unknown>;
  severity?: AlertSeverity;
  syncRunId?: string;
}

/**
 * Grava um `CanaryCheck` e, se falhou, abre o `Alert` correspondente.
 *
 * As duas coisas juntas de propósito: a checagem é o histórico (permite ver a
 * série temporal e calibrar limiar), o alerta é a interrupção. Separá-las
 * abriria espaço para uma falha registrada que nunca avisa ninguém.
 */
export async function registrarChecagem(
  registro: RegistroDeChecagem,
  notifier: Notifier = notifierPadrao(),
): Promise<{ checkId: string; alertId: string | null; avisou: boolean }> {
  const check = await prisma.canaryCheck.create({
    data: {
      layer: registro.layer,
      target: registro.target,
      passed: registro.passed,
      measuredValue: registro.measuredValue ?? null,
      threshold: registro.threshold ?? null,
      message: registro.message ?? null,
      details: (registro.details ?? {}) as Prisma.InputJsonValue,
      syncRunId: registro.syncRunId ?? null,
    },
    select: { id: true },
  });

  if (registro.passed) {
    // a checagem voltou a passar: fecha o alerta aberto, se houver
    await resolverAlerta(fingerprintDe(registro));
    return { checkId: check.id, alertId: null, avisou: false };
  }

  const resultado = await abrirAlerta(
    {
      fingerprint: fingerprintDe(registro),
      severity: registro.severity ?? 'warning',
      message: registro.message ?? `${registro.layer}: ${registro.target}`,
      canaryCheckId: check.id,
      details: registro.details,
    },
    notifier,
  );

  return { checkId: check.id, ...resultado };
}

/** A identidade de um problema, para não reenviar o mesmo alerta. */
export function fingerprintDe(registro: Pick<RegistroDeChecagem, 'layer' | 'target'>): string {
  return `${registro.layer}:${registro.target}`;
}

interface DadosDoAlerta {
  fingerprint: string;
  severity: AlertSeverity;
  message: string;
  canaryCheckId?: string;
  details?: Record<string, unknown>;
}

/**
 * Abre um alerta — ou não faz nada, se já houver um aberto com o mesmo
 * fingerprint (§8: "não reenviar o mesmo alerta enquanto não resolvido").
 *
 * A garantia é do banco, não do código: o índice parcial
 * `alerts_one_open_per_fingerprint` cobre `(fingerprint) WHERE resolved_at IS
 * NULL`. Dois jobs simultâneos que detectem o mesmo problema não conseguem
 * abrir dois alertas nem que tentem.
 */
export async function abrirAlerta(
  dados: DadosDoAlerta,
  notifier: Notifier = notifierPadrao(),
): Promise<{ alertId: string; avisou: boolean }> {
  const jaAberto = await prisma.alert.findFirst({
    where: { fingerprint: dados.fingerprint, resolvedAt: null },
    select: { id: true, createdAt: true },
  });

  if (jaAberto) {
    log.debug('alerta já aberto; não reenviado', {
      fingerprint: dados.fingerprint,
      desde: jaAberto.createdAt,
    });
    return { alertId: jaAberto.id, avisou: false };
  }

  const alerta = await prisma.alert.create({
    data: {
      fingerprint: dados.fingerprint,
      severity: dados.severity,
      message: dados.message,
      canaryCheckId: dados.canaryCheckId ?? null,
      details: (dados.details ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  try {
    const entregues = await notifier.enviar({
      severity: dados.severity,
      titulo: dados.fingerprint,
      mensagem: dados.message,
      fingerprint: dados.fingerprint,
      ...(dados.details ? { detalhes: dados.details } : {}),
    });

    // `sentAt` só marca se ALGUÉM entregou, e `notifier` guarda QUEM.
    // Marcar como enviado porque o log funcionou faria o /health/sync dizer
    // "enviado: sim" para um alerta que nunca chegou ao celular.
    if (entregues.length > 0) {
      await prisma.alert.update({
        where: { id: alerta.id },
        data: { sentAt: new Date(), notifier: entregues.join('+') },
      });
    } else {
      log.warn('alerta registrado, mas nenhum canal entregou', { fingerprint: dados.fingerprint });
    }
  } catch (erro) {
    // o alerta fica no banco sem `sentAt`: aparece no /health/sync mesmo que
    // o canal de envio esteja fora
    log.error('não consegui enviar o alerta; ele fica registrado no banco', {
      fingerprint: dados.fingerprint,
      erro,
    });
  }

  return { alertId: alerta.id, avisou: true };
}

export async function resolverAlerta(fingerprint: string): Promise<number> {
  const { count } = await prisma.alert.updateMany({
    where: { fingerprint, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });

  if (count > 0) log.info('alerta resolvido', { fingerprint, count });
  return count;
}

export async function alertasAbertos(): Promise<
  Array<{
    id: string;
    severity: AlertSeverity;
    message: string;
    fingerprint: string;
    createdAt: Date;
    sentAt: Date | null;
    notifier: string | null;
  }>
> {
  return prisma.alert.findMany({
    where: { resolvedAt: null },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      severity: true,
      message: true,
      fingerprint: true,
      createdAt: true,
      sentAt: true,
      notifier: true,
    },
  });
}

/** Últimas checagens por alvo — o painel do `/health/sync`. */
export async function ultimasChecagens(): Promise<
  Array<{
    layer: CanaryLayer;
    target: string;
    passed: boolean;
    measuredValue: number | null;
    threshold: number | null;
    message: string | null;
    checkedAt: Date;
  }>
> {
  return prisma.$queryRaw`
    SELECT DISTINCT ON (layer, target)
      layer, target, passed,
      measured_value AS "measuredValue",
      threshold, message,
      checked_at AS "checkedAt"
    FROM canary_checks
    ORDER BY layer, target, checked_at DESC
  `;
}
