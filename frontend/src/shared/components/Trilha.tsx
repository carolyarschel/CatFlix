import type { CardDeTitulo } from '../api/tipos';
import { PosterCard } from './PosterCard';
import styles from './Trilha.module.scss';

/**
 * Trilha horizontal de pôsteres (§12): título acima e o próximo card espiando
 * na borda direita, que é o que convida a arrastar.
 */
export function Trilha({
  id,
  titulo,
  itens,
  total,
  aoAbrir,
  aoVerTodos,
}: {
  id: string;
  titulo: string;
  itens: CardDeTitulo[];
  /** quantos existem no total; maior que `itens.length` acende o "Ver todos" */
  total?: number;
  aoAbrir?: (id: string) => void;
  aoVerTodos?: (id: string) => void;
}) {
  if (itens.length === 0) return null;

  // A trilha mostra no máximo 24 (§ corte da home). Sem este botão, o que passa
  // disso sumia do app — e como a ordem é por número de sessões, quem sumia era
  // sempre o filme pequeno ou o que está acabando.
  const escondidos = Math.max(0, (total ?? itens.length) - itens.length);

  return (
    <section className={styles.trilha} id={id} aria-labelledby={`${id}-titulo`}>
      <div className={styles.cabecalho}>
        <h2 className={styles.titulo} id={`${id}-titulo`}>
          {titulo}
        </h2>

        {escondidos > 0 && aoVerTodos ? (
          <button
            type="button"
            className={styles.verTodos}
            onClick={() => aoVerTodos(id)}
            aria-label={`Ver todos os ${total} de ${titulo}`}
          >
            Ver todos ({total})
          </button>
        ) : null}
      </div>

      <div className={styles.esteira}>
        {itens.map((item) => (
          <PosterCard key={item.id} titulo={item} aoAbrir={aoAbrir} />
        ))}

        {/* o último lugar da esteira repete a saída: quem arrasta até o fim
            encontra o caminho onde já está olhando, sem voltar ao cabeçalho */}
        {escondidos > 0 && aoVerTodos ? (
          <button type="button" className={styles.cartaoFinal} onClick={() => aoVerTodos(id)}>
            <span className={styles.mais}>+{escondidos}</span>
            <span className={styles.rotuloFinal}>Ver todos</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
