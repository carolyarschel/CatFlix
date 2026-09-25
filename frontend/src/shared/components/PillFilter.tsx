import styles from './PillFilter.module.scss';

/**
 * Pills translúcidas do topo da home (§12): Em cartaz, Pré-estreias, Em breve,
 * Tags ▾.
 *
 * O item ativo usa o acento do perfil — é a confirmação visual mais barata de
 * que a troca de perfil pegou.
 */

export interface OpcaoDeFiltro {
  id: string;
  rotulo: string;
}

export function PillFilter({
  opcoes,
  ativa,
  aoEscolher,
  extra,
}: {
  opcoes: OpcaoDeFiltro[];
  ativa: string | null;
  aoEscolher: (id: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className={styles.faixa} role="group" aria-label="Filtros da home">
      {opcoes.map((opcao) => (
        <button
          key={opcao.id}
          type="button"
          className={opcao.id === ativa ? `${styles.pill} ${styles.ativa}` : styles.pill}
          aria-pressed={opcao.id === ativa}
          onClick={() => aoEscolher(opcao.id)}
        >
          {opcao.rotulo}
        </button>
      ))}
      {extra}
    </div>
  );
}
