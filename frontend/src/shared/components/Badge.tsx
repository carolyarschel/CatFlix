import styles from './Badge.module.scss';

/**
 * Badge numérica da navegação (§2): aparece só quando há pendência.
 *
 * Devolver `null` no zero não é detalhe de estilo — é a regra do contexto, e um
 * "0" rosa no canto do ícone diria justamente o contrário do que se quer dizer.
 */
export function Badge({ valor }: { valor: number }) {
  if (valor <= 0) return null;

  return <span className={styles.badge}>{valor > 99 ? '99+' : valor}</span>;
}
