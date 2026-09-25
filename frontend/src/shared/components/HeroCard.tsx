import type { HeroDaHome } from '../api/tipos';
import styles from './HeroCard.module.scss';

/**
 * Destaque do topo da home (§12): pôster alto, título grande, linha de
 * taxonomia com separadores e dois botões de largura total.
 *
 * O rótulo do botão secundário é o apelido do OUTRO perfil — "Marcar com o
 * Urso" na tela da Carol, "Marcar com a Gata" na dele. É o que os dois modelos
 * mobile mostram, e a graça do app é justamente combinar de ir junto.
 */

const APELIDO_DO_PAR: Record<string, string> = {
  catflix: 'Marcar com o Urso',
  hburso: 'Marcar com a Gata',
};

export function HeroCard({
  hero,
  perfil,
  aoVerSessoes,
  aoMarcar,
}: {
  hero: HeroDaHome;
  perfil: string;
  aoVerSessoes?: (id: string) => void;
  aoMarcar?: (id: string) => void;
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
              <span key={marca.userId} className={styles.marca} style={{ background: marca.acento }}>
                {marca.inicial}
              </span>
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
          onClick={() => aoMarcar?.(hero.id)}
          disabled={!aoMarcar}
        >
          {APELIDO_DO_PAR[perfil] ?? 'Marcar'}
        </button>
      </div>
    </section>
  );
}
