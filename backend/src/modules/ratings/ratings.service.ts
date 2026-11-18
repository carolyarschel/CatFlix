import { Prisma } from '@prisma/client';
import type { Pessoa, PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';

/**
 * Notas do casal: 0 a 10 com meio ponto, uma por pessoa e filme — a escala de
 * todo o ecossistema Gatur (cineon-expansao §2).
 *
 * Este módulo não sabe quem assistiu. "Só dá nota quem participou de alguma
 * visualização" é regra do orquestrador `library`, porque cruza com `watches`.
 */

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

export interface NotaDaPessoa {
  pessoa: Pessoa;
  /** número, não Decimal: 8.5 */
  nota: number;
  atualizadoEm: Date;
}

export function validarNota(nota: number): void {
  if (!Number.isFinite(nota) || nota < 0 || nota > 10 || !Number.isInteger(nota * 2)) {
    throw new ValidationError('A nota vai de 0 a 10, em passos de meio ponto.');
  }
}

/**
 * Grava a nota. Reativa a linha se ela tinha sido removida, e todo upsert muda
 * `updatedAt` — é por ele que o feed do CG reenvia as visualizações (§10.2).
 */
export async function definirNota(
  titleId: string,
  pessoa: Pessoa,
  nota: number,
  db: ClientePrisma = prisma,
): Promise<NotaDaPessoa> {
  validarNota(nota);
  const score = new Prisma.Decimal(nota);

  const linha = await db.rating.upsert({
    where: { titleId_pessoa: { titleId, pessoa } },
    create: { titleId, pessoa, score },
    update: { score, removedAt: null },
    select: { pessoa: true, score: true, updatedAt: true },
  });

  return { pessoa: linha.pessoa, nota: Number(linha.score), atualizadoEm: linha.updatedAt };
}

export async function removerNota(titleId: string, pessoa: Pessoa): Promise<{ removidoEm: Date }> {
  const removidoEm = new Date();
  const { count } = await prisma.rating.updateMany({
    where: { titleId, pessoa, removedAt: null },
    data: { removedAt: removidoEm },
  });
  if (count === 0) throw new NotFoundError('Você ainda não deu nota a este filme.');
  return { removidoEm };
}

export async function notasDoTitulo(titleId: string): Promise<NotaDaPessoa[]> {
  const linhas = await prisma.rating.findMany({
    where: { titleId, removedAt: null },
    orderBy: { pessoa: 'asc' },
    select: { pessoa: true, score: true, updatedAt: true },
  });
  return linhas.map((l) => ({ pessoa: l.pessoa, nota: Number(l.score), atualizadoEm: l.updatedAt }));
}

/** "Remover do catálogo" (§4.4): todas as notas do título, com um carimbo só. */
export async function removerNotasDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.rating.updateMany({ where: { titleId, removedAt: null }, data: { removedAt: removidoEm } })
  ).count;
}

export async function restaurarNotasDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.rating.updateMany({ where: { titleId, removedAt: removidoEm }, data: { removedAt: null } })
  ).count;
}
