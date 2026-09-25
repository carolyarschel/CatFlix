import styles from './RatingBadges.module.scss';

/**
 * Marcadores de nota do §12: quadrado amarelo para o IMDb, círculo vermelho
 * para o Rotten Tomatoes, sempre com o valor em texto ao lado.
 *
 * Nota que falta simplesmente não aparece — o §5.3 diz que qualquer nota pode
 * faltar, e um "—" no lugar do número só ocuparia o espaço com nada.
 */
export function RatingBadges({ imdb, rt }: { imdb: string | null; rt: string | null }) {
  if (!imdb && !rt) return null;

  return (
    <div className={styles.notas}>
      {imdb ? (
        <span className={styles.nota}>
          <span className={styles.marcaImdb} aria-hidden="true" />
          <span className={styles.visualmenteOculto}>Nota IMDb</span>
          {imdb}
        </span>
      ) : null}
      {rt ? (
        <span className={styles.nota}>
          <span className={styles.marcaRt} aria-hidden="true" />
          <span className={styles.visualmenteOculto}>Nota Rotten Tomatoes</span>
          {rt}
        </span>
      ) : null}
    </div>
  );
}
