import type { SessoesPorCinema } from './api/tipos';

/**
 * Filtro de sessões por tipo de sala, usado no detalhe do filme e na
 * programação do dia. Mora aqui para as duas telas concordarem sobre o que é
 * "Comum" e o que é "3D".
 */

/**
 * Rótulo da sala sem formato.
 *
 * O backend manda `sala: null` para sala comum, porque escrever "Normal" em
 * cada horário só ocuparia espaço. No filtro ela precisa de nome: "só as
 * comuns" é justamente o que se pede para não pagar VIP.
 */
export const SALA_COMUM = 'Comum';

/**
 * 3D não é sala, é atributo da sessão (existe "IMAX 3D"), mas é pedido como se
 * fosse — por isso entra no mesmo filtro.
 */
export const SALA_3D = '3D';

/**
 * As salas que aparecem nestas sessões, na ordem em que aparecem.
 *
 * Saem das sessões que estão na tela, não da lista global de formatos:
 * oferecer "IMAX" onde nada passa em IMAX seria um filtro que só sabe devolver
 * vazio.
 */
export function salasDasSessoes(cinemas: SessoesPorCinema[]): string[] {
  const vistas = new Set<string>();
  for (const cinema of cinemas) {
    for (const sessao of cinema.sessoes) {
      vistas.add(sessao.sala ?? SALA_COMUM);
      if (sessao.is3d) vistas.add(SALA_3D);
    }
  }
  return [...vistas];
}

/**
 * Só as sessões da sala escolhida. Cinema que fica sem nenhuma sai da lista:
 * um nome de cinema com nada embaixo parece defeito.
 */
export function filtrarPorSala(cinemas: SessoesPorCinema[], sala: string | null): SessoesPorCinema[] {
  if (!sala) return cinemas;

  return cinemas
    .map((cinema) => ({
      ...cinema,
      sessoes: cinema.sessoes.filter((s) =>
        sala === SALA_3D ? s.is3d : (s.sala ?? SALA_COMUM) === sala,
      ),
    }))
    .filter((cinema) => cinema.sessoes.length > 0);
}
