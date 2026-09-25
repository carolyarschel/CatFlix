import { useEffect } from 'react';

/**
 * Aplica o tema do perfil: escreve `data-profile` no `<html>` e deixa as
 * variáveis CSS do `reset.scss` fazerem o resto, sem recarregar a página
 * (critério de aceite nº 7).
 *
 * ⚠️ **Não escolhe mais o perfil, e não guarda nada no `localStorage`.** Desde
 * 23/09/2026 quem manda é a sessão do login (§3): guardar o perfil no navegador
 * faria a tela mostrar o acento de um enquanto o backend responde com os dados
 * do outro. O argumento existe para a tela de login poder pré-visualizar o
 * acento do perfil que está sendo escolhido, antes de haver sessão.
 */

export const PERFIS = ['catflix', 'hburso'] as const;
export type Perfil = (typeof PERFIS)[number];

const PADRAO: Perfil = 'catflix';

export function ehPerfil(valor: unknown): valor is Perfil {
  return typeof valor === 'string' && (PERFIS as readonly string[]).includes(valor);
}

export function useProfile(perfil: string | null): void {
  useEffect(() => {
    document.documentElement.dataset.profile = ehPerfil(perfil) ? perfil : PADRAO;
  }, [perfil]);
}
