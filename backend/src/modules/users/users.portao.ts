import {
  criarPortao,
  type ArmazenamentoDeSessoes,
  type Papel,
  type Portao,
  type SessaoGuardada,
  type UsuarioPortao,
} from 'gatur-portao-client/express';
import type { Prisma } from '@prisma/client';
import { configDoPortao, isProduction } from '../../config/env';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';

const log = logger.child({ module: 'auth' });

/**
 * Login pelo Portão de Gatur (OAuth 2.1 / OIDC).
 *
 * O resto do app continua perguntando `req.perfil` (§3): o Portão identifica a
 * pessoa pelo papel, e o papel vira o perfil do Cineon. São duas pessoas para
 * sempre, então o mapa é fixo — e todos os dados existentes (estado dos
 * títulos, tags, inscrições de push) continuam nos mesmos perfis.
 */
export const PERFIL_DO_PAPEL: Record<Papel, string> = {
  CAT: 'catflix',
  BEAR: 'hburso',
};

/** Sessões no banco do Cineon (tabela `portao_sessoes`), nunca em memória. */
const armazenamento: ArmazenamentoDeSessoes = {
  async criar(s) {
    await prisma.portaoSessao.create({
      data: {
        id: s.id,
        usuarioId: s.usuario.id,
        usuario: s.usuario as unknown as Prisma.InputJsonValue,
        sid: s.sid,
        idToken: s.idToken,
        criadaEm: s.criadaEm,
        expiraEm: s.expiraEm,
      },
    });
  },
  async buscar(id) {
    const linha = await prisma.portaoSessao.findUnique({ where: { id } });
    if (!linha) return null;
    const sessao: SessaoGuardada = {
      id: linha.id,
      usuario: linha.usuario as unknown as UsuarioPortao,
      sid: linha.sid,
      idToken: linha.idToken,
      criadaEm: linha.criadaEm,
      expiraEm: linha.expiraEm,
    };
    return sessao;
  },
  async apagar(id) {
    await prisma.portaoSessao.deleteMany({ where: { id } });
  },
  async apagarPorSid(sid) {
    return (await prisma.portaoSessao.deleteMany({ where: { sid } })).count;
  },
  async apagarPorUsuario(usuarioId) {
    return (await prisma.portaoSessao.deleteMany({ where: { usuarioId } })).count;
  },
};

function criar(): Portao | null {
  const config = configDoPortao();
  if (!config) return null;

  return criarPortao({
    app: 'cineon',
    ...config,
    armazenamento,
    producao: isProduction,
    log: (nivel, mensagem) => log[nivel](mensagem),
  });
}

/** `null` = Portão desligado (sem `PORTAO_ISSUER`): vale o login por senha. */
export const portao = criar();

/** Sessões vencidas só somem quando alguém tenta usá-las; isto limpa o resto. */
export async function limparSessoesVencidas(): Promise<number> {
  const { count } = await prisma.portaoSessao.deleteMany({ where: { expiraEm: { lt: new Date() } } });
  return count;
}
