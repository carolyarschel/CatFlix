import type { PerfilDoApp, Pessoa } from './api/tipos';

/**
 * Perfil do app (`catflix`/`hburso`) ↔ pessoa do ecossistema Gatur
 * (`CAT`/`BEAR`). É o mesmo mapa do backend (`users.papel`); o acervo do casal
 * fala em pessoas, as telas antigas em perfis.
 */
export const PESSOA_DO_PERFIL: Record<string, Pessoa> = {
  catflix: 'CAT',
  hburso: 'BEAR',
};

export const PERFIL_DA_PESSOA: Record<Pessoa, string> = {
  CAT: 'catflix',
  BEAR: 'hburso',
};

export function outraPessoa(pessoa: Pessoa): Pessoa {
  return pessoa === 'CAT' ? 'BEAR' : 'CAT';
}

/** O perfil (nome, inicial, acento) de uma pessoa, dentro da lista de perfis. */
export function perfilDaPessoa(perfis: PerfilDoApp[], pessoa: Pessoa): PerfilDoApp | undefined {
  return perfis.find((p) => p.id === PERFIL_DA_PESSOA[pessoa]);
}
