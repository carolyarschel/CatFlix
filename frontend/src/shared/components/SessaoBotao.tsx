import type { SessaoDoDia } from '../api/tipos';
import styles from './SessaoBotao.module.scss';

/**
 * Um horário de sessão.
 *
 * Vira link quando há URL de compra e um `span` quando não há — um botão que
 * não faz nada é pior do que um horário que só informa.
 *
 * Mora em `shared/` porque o detalhe do filme e a programação do dia mostram o
 * mesmo horário do mesmo jeito.
 *
 * ⚠️ **O tipo da sessão não aparece de propósito.** `sessionKind` sai de
 * `inPreSale`, que no ingresso é pré-venda e não pré-estreia: 434 das 504
 * sessões futuras estão marcadas como `pre_estreia`, inclusive as de filme que
 * já estreou (pendência 1 do README). Carimbar "Pré-estreia" em tudo seria pior
 * do que não dizer nada.
 */
export function SessaoBotao({ sessao }: { sessao: SessaoDoDia }) {
  const detalhes = [sessao.sala, sessao.is3d ? '3D' : null, sessao.audioRotulo]
    .filter(Boolean)
    .join(' · ');

  const conteudo = (
    <>
      <span className={styles.hora}>{sessao.horario}</span>
      {detalhes ? <span className={styles.detalhes}>{detalhes}</span> : null}
    </>
  );

  if (!sessao.urlCompra) {
    return (
      <span className={`${styles.sessao} ${styles.semLink}`} title="Sem link de compra">
        {conteudo}
      </span>
    );
  }

  return (
    <a
      className={styles.sessao}
      href={sessao.urlCompra}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Comprar ingresso para a sessão das ${sessao.horario}${detalhes ? `, ${detalhes}` : ''}`}
    >
      {conteudo}
    </a>
  );
}
