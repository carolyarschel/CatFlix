import { createHash } from 'node:crypto';
import type { Prisma, RawSource } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { redigirParametros } from './redact';

const log = logger.child({ module: 'raw-payload' });

export interface RegistrarPayloadInput {
  source: RawSource;
  endpoint: string;
  params?: Record<string, string>;
  /** corpo CRU, como veio da rede — antes de qualquer parsing */
  bodyText: string;
  httpStatus: number;
  syncRunId?: string;
}

/**
 * Grava a resposta bruta ANTES de qualquer validação ou parsing (§7.1).
 *
 * É isto que permite reprocessar o histórico sem rechamar a API, e é por isso
 * que a função recebe `bodyText` e não um objeto já parseado: um payload que
 * quebrou o schema é exatamente o que mais precisamos guardar.
 */
export async function registrarRawPayload(input: RegistrarPayloadInput): Promise<string> {
  const bodyHash = createHash('sha256').update(input.bodyText).digest('hex');

  // O corpo vai para uma coluna jsonb. Se não for JSON válido — que é
  // justamente o caso de contrato quebrado — guardamos o texto envelopado em
  // vez de perder a evidência.
  let body: Prisma.InputJsonValue;
  try {
    body = input.bodyText === '' ? { _vazio: true } : (JSON.parse(input.bodyText) as Prisma.InputJsonValue);
  } catch {
    body = { _naoEhJson: true, _texto: input.bodyText.slice(0, 100_000) };
  }

  const registro = await prisma.rawPayload.create({
    data: {
      source: input.source,
      endpoint: input.endpoint,
      params: redigirParametros(input.params ?? {}),
      bodyHash,
      body,
      httpStatus: input.httpStatus,
      syncRunId: input.syncRunId ?? null,
    },
    select: { id: true },
  });

  log.debug('payload bruto gravado', {
    id: registro.id,
    source: input.source,
    endpoint: input.endpoint,
    httpStatus: input.httpStatus,
    bytes: input.bodyText.length,
  });

  return registro.id;
}

/**
 * Último payload bem-sucedido de um endpoint. Alimenta o modo degradado (§8):
 * se a API caiu, o app serve isto e mostra "dados de X horas atrás".
 */
export async function ultimoPayloadBemSucedido(
  source: RawSource,
  endpoint: string,
): Promise<{ id: string; body: Prisma.JsonValue; fetchedAt: Date } | null> {
  return prisma.rawPayload.findFirst({
    where: { source, endpoint, httpStatus: { gte: 200, lt: 300 } },
    orderBy: { fetchedAt: 'desc' },
    select: { id: true, body: true, fetchedAt: true },
  });
}
