import type { HeroDaHome } from '../api/tipos';
import { SeloDePessoa } from './SeloDePessoa';
import styles from './HeroCard.module.scss';

/**
 * Destaque do topo da home (§12): pôster alto, título grande, linha de
 * taxonomia com separadores e dois botões de largura total.
 *
 * O secundário era "Marcar com o Urso / com a Gata". O "marcado" saiu do app
 * (decisão de 18/11/2026) e o botão virou **"Quero assistir"**: põe o filme na
 * lista de quem está logado, direto da home, e tocar de novo tira. Os rostos
 * no canto do pôster dizem quem já quer.
 */
export function HeroCard({
  hero,
  naMinhaLista,
  salvando = false,
  aoVerSessoes,
  aoAlternarLista,
}: {
  hero: HeroDaHome;
  /** o filme está na lista "quero assistir" de quem está logado */
  naMinhaLista: boolean;
  salvando?: boolean;
  aoVerSessoes?: (id: string) => void;
  aoAlternarLista?: (id: string) => void;
}) {
  return (
    <section className={styles.hero}>
      <div className={styles.palco}>
        {hero.posterUrl ? (
          <img className={styles.imagem} src={hero.posterUrl} alt="" decoding="async" />
        ) : null}

        {hero.marcadoPor.length > 0 ? (
          <span className={styles.marcas}>
            {hero.marcadoPor.map((marca) => (
              <SeloDePessoa
                key={marca.userId}
                perfilId={marca.userId}
                acento={marca.acento}
                tamanho={30}
                rotulo={`Na lista de ${marca.nome}`}
              />
            ))}
          </span>
        ) : null}

        <h2 className={styles.titulo}>{hero.titulo}</h2>
      </div>

      <div className={styles.rodape}>
        <p className={styles.taxonomia}>
          {hero.taxonomia.map((parte, indice) => (
            <span key={parte} className={indice === 0 ? styles.destaque : undefined}>
              {indice > 0 ? <span className={styles.separador}>•</span> : null}
              {parte}
            </span>
          ))}
        </p>

        <button
          type="button"
          className={styles.primario}
          onClick={() => aoVerSessoes?.(hero.id)}
        >
          Ver sessões
        </button>

        <button
          type="button"
          className={styles.secundario}
          onClick={() => aoAlternarLista?.(hero.id)}
          disabled={!aoAlternarLista || salvando}
          aria-pressed={naMinhaLista}
        >
          {naMinhaLista ? 'Na sua lista ✓' : 'Quero assistir'}
        </button>
      </div>
    </section>
  );
}
