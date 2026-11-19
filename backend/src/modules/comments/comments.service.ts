import type { Pessoa, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';

/**
 * O comentário de cada pessoa sobre o filme (pedido de 19/11/2026): um por
 * pessoa e filme, como a nota, e editável depois de salvo.
 *
 * Não depende de ninguém: comentar não exige ter assistido (no CG antigo
 * também não exigia — dá para comentar o trailer de um filme da lista). Cada
 * pessoa edita só o próprio comentário; quem é a pessoa vem da sessão.
 *
 * Não é a observação da visualização (`Watch.note`), que fala daquela sessão.
 */

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

export const TAMANHO_MAXIMO_DO_COMENTARIO = 4000;

export interface ComentarioDaPessoa {
  pessoa: Pessoa;
  texto: string;
  atualizadoEm: Date;
}

/** Espaços nas pontas saem; as quebras de linha do meio ficam. */
export function limparComentario(texto: string): string {
  const limpo = texto.replace(/\r\n/g, '\n').trim();
  if (limpo.length > TAMANHO_MAXIMO_DO_COMENTARIO) {
    throw new ValidationError(`O comentário passa de ${TAMANHO_MAXIMO_DO_COMENTARIO} caracteres.`);
  }
  return limpo;
}

/**
 * Grava (ou reescreve) o comentário. Texto vazio apaga: é o que acontece quando
 * a pessoa limpa o campo e salva.
 */
export async function definirComentario(
  titleId: string,
  pessoa: Pessoa,
  texto: string,
  db: ClientePrisma = prisma,
): Promise<ComentarioDaPessoa | null> {
  const limpo = limparComentario(texto);

  const existe = await db.title.findUnique({ where: { id: titleId }, select: { id: true } });
  if (!existe) throw new NotFoundError(`Título "${titleId}" não existe.`);

  if (limpo.length === 0) {
    await db.comment.updateMany({ where: { titleId, pessoa, removedAt: null }, data: { removedAt: new Date() } });
    return null;
  }

  const linha = await db.comment.upsert({
    where: { titleId_pessoa: { titleId, pessoa } },
    create: { titleId, pessoa, text: limpo },
    update: { text: limpo, removedAt: null },
    select: { pessoa: true, text: true, updatedAt: true },
  });
  return { pessoa: linha.pessoa, texto: linha.text, atualizadoEm: linha.updatedAt };
}

export async function removerComentario(titleId: string, pessoa: Pessoa): Promise<{ removidoEm: Date }> {
  const removidoEm = new Date();
  const { count } = await prisma.comment.updateMany({
    where: { titleId, pessoa, removedAt: null },
    data: { removedAt: removidoEm },
  });
  if (count === 0) throw new NotFoundError('Você ainda não comentou este filme.');
  return { removidoEm };
}

export async function comentariosDoTitulo(titleId: string): Promise<ComentarioDaPessoa[]> {
  return comentariosDosTitulos([titleId]).then((m) => m.get(titleId) ?? []);
}

/** Para as listas: os comentários ativos de vários filmes numa consulta só. */
export async function comentariosDosTitulos(titleIds: string[]): Promise<Map<string, ComentarioDaPessoa[]>> {
  const linhas = await prisma.comment.findMany({
    where: { titleId: { in: titleIds }, removedAt: null },
    orderBy: { pessoa: 'asc' }, // CAT antes de BEAR, a ordem do enum
    select: { titleId: true, pessoa: true, text: true, updatedAt: true },
  });
  const porTitulo = new Map<string, ComentarioDaPessoa[]>();
  for (const l of linhas) {
    const lista = porTitulo.get(l.titleId) ?? [];
    lista.push({ pessoa: l.pessoa, texto: l.text, atualizadoEm: l.updatedAt });
    porTitulo.set(l.titleId, lista);
  }
  return porTitulo;
}

/** "Remover do catálogo" (§4.4): todos os comentários do título, com o mesmo carimbo. */
export async function removerComentariosDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.comment.updateMany({ where: { titleId, removedAt: null }, data: { removedAt: removidoEm } })
  ).count;
}

export async function restaurarComentariosDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.comment.updateMany({ where: { titleId, removedAt: removidoEm }, data: { removedAt: null } })
  ).count;
}
