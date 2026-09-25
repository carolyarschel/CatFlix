import webpush from 'web-push';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';

const log = logger.child({ module: 'push' });

/**
 * Inscrições de Web Push do PWA (§3, resolvido em 22/09/2026).
 *
 * Mora no módulo `canaries` porque hoje o único consumidor é o alerta. Quando
 * aparecer notificação voltada ao usuário ("abriu venda da pré-estreia que
 * você marcou"), isto provavelmente sobe para o módulo `users` — a inscrição é
 * de dispositivo, não de canary.
 */

/** O que o `PushSubscription` do navegador entrega. */
export const inscricaoSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type InscricaoDoNavegador = z.infer<typeof inscricaoSchema>;

let configurado = false;

/**
 * O Web Push exige VAPID: um par de chaves que prova ao serviço de push
 * (Google, Mozilla, Apple) que quem envia é o mesmo dono do app.
 */
export function pushConfigurado(): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;

  if (!configurado) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configurado = true;
  }

  return true;
}

export function chavePublica(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

/**
 * Registra (ou reaproveita) a inscrição de um dispositivo.
 *
 * O `endpoint` é a chave: o navegador pode reemitir as chaves da mesma
 * inscrição, e reinstalar o PWA gera endpoint novo. Por isso é upsert, e por
 * isso `expiredAt` é zerado — uma inscrição que voltou está viva de novo.
 */
export async function inscrever(
  inscricao: InscricaoDoNavegador,
  contexto: { userId?: string; userAgent?: string } = {},
): Promise<{ id: string; nova: boolean }> {
  const existente = await prisma.pushSubscription.findUnique({
    where: { endpoint: inscricao.endpoint },
    select: { id: true },
  });

  const registro = await prisma.pushSubscription.upsert({
    where: { endpoint: inscricao.endpoint },
    update: {
      p256dh: inscricao.keys.p256dh,
      auth: inscricao.keys.auth,
      userId: contexto.userId ?? null,
      userAgent: contexto.userAgent ?? null,
      expiredAt: null,
      failureCount: 0,
    },
    create: {
      endpoint: inscricao.endpoint,
      p256dh: inscricao.keys.p256dh,
      auth: inscricao.keys.auth,
      userId: contexto.userId ?? null,
      userAgent: contexto.userAgent ?? null,
    },
    select: { id: true },
  });

  log.info(existente ? 'inscrição de push atualizada' : 'novo dispositivo inscrito', {
    id: registro.id,
    userId: contexto.userId,
  });

  return { id: registro.id, nova: !existente };
}

export async function desinscrever(endpoint: string): Promise<boolean> {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return count > 0;
}

export interface ResultadoDoEnvio {
  enviados: number;
  expirados: number;
  falhas: number;
  semInscricao: boolean;
}

/**
 * Manda uma notificação para todos os dispositivos vivos.
 *
 * Um endpoint que responde **404 ou 410** está morto de verdade — app
 * desinstalado, permissão revogada, navegador limpo. Insistir nele é lixo que
 * só cresce, então ele é marcado como expirado e sai da lista.
 */
export async function enviarParaTodos(payload: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
}): Promise<ResultadoDoEnvio> {
  if (!pushConfigurado()) {
    log.warn('Web Push sem chaves VAPID: nada enviado');
    return { enviados: 0, expirados: 0, falhas: 0, semInscricao: true };
  }

  const inscricoes = await prisma.pushSubscription.findMany({
    where: { expiredAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (inscricoes.length === 0) {
    // não é erro: até o PWA existir e alguém aceitar a permissão, não há para
    // onde mandar. O log e o /health/sync continuam sendo o canal.
    return { enviados: 0, expirados: 0, falhas: 0, semInscricao: true };
  }

  const corpo = JSON.stringify(payload);
  let enviados = 0;
  let expirados = 0;
  let falhas = 0;

  for (const inscricao of inscricoes) {
    try {
      await webpush.sendNotification(
        {
          endpoint: inscricao.endpoint,
          keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
        },
        corpo,
        { TTL: 3600 },
      );

      await prisma.pushSubscription.update({
        where: { id: inscricao.id },
        data: { lastSentAt: new Date(), failureCount: 0 },
      });
      enviados += 1;
    } catch (erro) {
      const status = (erro as { statusCode?: number }).statusCode;

      if (status === 404 || status === 410) {
        await prisma.pushSubscription.update({
          where: { id: inscricao.id },
          data: { expiredAt: new Date() },
        });
        expirados += 1;
        log.info('inscrição expirada, marcada e removida da lista', { id: inscricao.id, status });
        continue;
      }

      await prisma.pushSubscription.update({
        where: { id: inscricao.id },
        data: { failureCount: { increment: 1 } },
      });
      falhas += 1;
      log.error('falha ao enviar push', { id: inscricao.id, status, erro });
    }
  }

  return { enviados, expirados, falhas, semInscricao: false };
}

export async function inscricoesVivas(): Promise<number> {
  return prisma.pushSubscription.count({ where: { expiredAt: null } });
}
