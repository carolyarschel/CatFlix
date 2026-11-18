import type { Pessoa } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../shared/prisma';
import { NaoAutenticadoError } from './users.middleware';

/**
 * Ponte entre o perfil da sessão (`catflix`/`hburso`) e a pessoa do
 * ecossistema Gatur (`CAT`/`BEAR`), que é como o acervo do casal e o feed do
 * Crônicas de Gatur falam (cineon-expansao §2).
 *
 * A fonte é `users.papel`, preenchido pela migration e pelo seed. Em cache de
 * processo: são dois perfis fixos, e o mapa não muda sem migration.
 */

let cache: Map<string, Pessoa> | null = null;

async function mapa(): Promise<Map<string, Pessoa>> {
  if (cache) return cache;

  const usuarios = await prisma.user.findMany({
    where: { papel: { not: null } },
    select: { id: true, papel: true },
  });
  cache = new Map(usuarios.map((u) => [u.id, u.papel as Pessoa]));
  return cache;
}

export async function pessoaDoPerfil(perfilId: string): Promise<Pessoa> {
  const pessoa = (await mapa()).get(perfilId);
  if (!pessoa) {
    // perfil sem papel é instalação sem a migration do acervo ou sem o seed:
    // melhor falhar alto do que gravar no nome da pessoa errada
    throw new Error(`O perfil "${perfilId}" não tem papel (CAT/BEAR). Rode a migration e o seed.`);
  }
  return pessoa;
}

/** A pessoa logada. Nunca vem de parâmetro: sempre da sessão (§3). */
export async function pessoaDaRequisicao(req: Request): Promise<Pessoa> {
  if (!req.perfil) throw new NaoAutenticadoError('Entre com um perfil para continuar.');
  return pessoaDoPerfil(req.perfil);
}

/** Só para os testes. */
export function limparCacheDePessoas(): void {
  cache = null;
}
