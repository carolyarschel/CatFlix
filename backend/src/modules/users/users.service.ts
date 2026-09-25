import type { UserTitleStatus } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import type { PerfilDoApp } from '../catalog/catalog.types';

const log = logger.child({ module: 'users' });

/**
 * Perfis do app: dois registros fixos, criados pelo seed (§6).
 *
 * A autenticação do §3 vive em `users.sessao.ts` e `users.middleware.ts`; a
 * escrita de `UserTitleState` (passo 11) está no fim deste arquivo.
 */
export async function listarPerfis(): Promise<PerfilDoApp[]> {
  const usuarios = await prisma.user.findMany({ orderBy: { id: 'asc' } });

  return usuarios.map((u) => ({
    id: u.id,
    nome: u.displayName,
    inicial: u.initial,
    acento: u.accent,
    acentoSecundario: u.accentSecondary,
  }));
}

export async function buscarPerfil(id: string): Promise<PerfilDoApp> {
  const usuario = await prisma.user.findUnique({ where: { id } });
  if (!usuario) {
    throw new NotFoundError(`Perfil "${id}" não existe.`);
  }

  return {
    id: usuario.id,
    nome: usuario.displayName,
    inicial: usuario.initial,
    acento: usuario.accent,
    acentoSecundario: usuario.accentSecondary,
  };
}

// ─────────────────────────────────────────────────────────────
// ESTADO DO USUÁRIO (§6 e passo 11 da §15)
// ─────────────────────────────────────────────────────────────

/**
 * O que a pessoa diz sobre o filme — separado de `Availability`, que é o que a
 * FONTE diz (§6).
 *
 * A separação não é organizacional: se fossem a mesma coisa, um filme sair de
 * cartaz apagaria a marcação da Carol. E é ela que prepara o §13 — o "visto"
 * poderá chegar por webhook do Jellyfin sem que o catálogo saiba.
 */
export interface EstadoDoTitulo {
  userId: string;
  titleId: string;
  status: UserTitleStatus;
  desde: Date;
}

/**
 * As três datas do §6 são um HISTÓRICO, não um espelho do status.
 *
 * "Quero ver" em março, "visto" em maio: as duas datas ficam. Por isso cada uma
 * só é escrita quando o estado correspondente acontece, e nenhuma é apagada na
 * transição — dá para responder "quanto tempo ela esperou por esse filme?".
 */
function carimboDe(status: UserTitleStatus, agora: Date) {
  return {
    ...(status === 'quero_ver' ? { wantedAt: agora } : {}),
    ...(status === 'marcado' ? { markedAt: agora } : {}),
    ...(status === 'visto' ? { watchedAt: agora } : {}),
  };
}

export async function definirEstado(
  userId: string,
  titleId: string,
  status: UserTitleStatus,
): Promise<EstadoDoTitulo> {
  const titulo = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true } });
  if (!titulo) {
    throw new NotFoundError(`Título "${titleId}" não existe.`);
  }

  const agora = new Date();

  const registro = await prisma.userTitleState.upsert({
    where: { userId_titleId: { userId, titleId } },
    update: { status, statusChangedAt: agora, source: 'app', ...carimboDe(status, agora) },
    create: { userId, titleId, status, statusChangedAt: agora, ...carimboDe(status, agora) },
    select: { userId: true, titleId: true, status: true, statusChangedAt: true },
  });

  log.info('estado definido', { userId, titleId, status });

  return {
    userId: registro.userId,
    titleId: registro.titleId,
    status: registro.status,
    desde: registro.statusChangedAt,
  };
}

/**
 * Tirar a marcação.
 *
 * Apaga a linha em vez de guardar um status "nenhum": o §6 só tem três estados,
 * e um quarto implícito apareceria em toda consulta que filtra por status.
 * Devolve `false` quando não havia nada — desmarcar duas vezes não é erro.
 */
export async function limparEstado(userId: string, titleId: string): Promise<boolean> {
  const { count } = await prisma.userTitleState.deleteMany({ where: { userId, titleId } });
  if (count > 0) log.info('estado removido', { userId, titleId });
  return count > 0;
}
