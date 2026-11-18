import { IconeMais } from './Icones';
import styles from './CabecalhoDaAba.module.scss';

/**
 * Cabeçalho das abas do acervo (cineon-expansao §8): título, uma linha de
 * contagem e o "+" — que, pelo §8, fica no cabeçalho de todas as telas.
 */
export function CabecalhoDaAba({
  titulo,
  subtitulo,
  aoAdicionar,
}: {
  titulo: string;
  subtitulo?: string | null;
  aoAdicionar: () => void;
}) {
  return (
    <header className={styles.cabecalho}>
      <div className={styles.textos}>
        <h1 className={styles.titulo}>{titulo}</h1>
        {subtitulo ? <p className={styles.subtitulo}>{subtitulo}</p> : null}
      </div>
      <button type="button" className={styles.acao} onClick={aoAdicionar} aria-label="Adicionar filme" title="Adicionar filme">
        <IconeMais />
      </button>
    </header>
  );
}
