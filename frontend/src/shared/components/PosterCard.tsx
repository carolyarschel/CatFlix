import type { CardDeTitulo } from '../api/tipos';
import { RatingBadges } from './RatingBadges';
import styles from './PosterCard.module.scss';

/**
 * O card de pôster do §12 — **o único card de trilha do app**.
 *
 * "Todos os cards de trilha são idênticos; só o conteúdo muda", e desde
 * 23/09/2026 isso vale também no desktop (§3): o card horizontal que o modelo
 * `desktop-catflix.html` propunha para pré-estreias foi descartado porque o app
 * é usado majoritariamente no celular, e duas formas de card significariam duas
 * formas de errar.
 */
export function PosterCard({
  titulo,
  aoAbrir,
}: {
  titulo: CardDeTitulo;
  aoAbrir?: (id: string) => void;
}) {
  const descricao = [
    titulo.titulo,
    titulo.ano ? `de ${titulo.ano}` : null,
    titulo.linha,
    titulo.faixa,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <article className={styles.card}>
      <button
        type="button"
        className={styles.botao}
        aria-label={`Abrir detalhes de ${descricao}`}
        onClick={() => aoAbrir?.(titulo.id)}
      >
        <div className={styles.poster}>
          {titulo.posterUrl ? (
            <img
              className={styles.imagem}
              src={titulo.posterUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className={styles.semPoster}>sem pôster</span>
          )}

          {/* §2: nenhum filme some. Sem metadata, o card avisa em vez de sumir. */}
          {titulo.orfao ? <span className={styles.pendente}>metadata pendente</span> : null}

          {/* os dois podem marcar o mesmo filme: as iniciais se enfileiram */}
          {titulo.marcadoPor.length > 0 ? (
            <span className={styles.marcas}>
              {titulo.marcadoPor.map((marca) => (
                <span
                  key={marca.userId}
                  className={styles.marca}
                  style={{ background: marca.acento }}
                  title={`Marcado por ${marca.userId}`}
                >
                  {marca.inicial}
                </span>
              ))}
            </span>
          ) : null}

          <span className={styles.nome}>{titulo.titulo}</span>

          {titulo.faixa ? <span className={styles.faixa}>{titulo.faixa}</span> : null}
        </div>
      </button>

      <RatingBadges imdb={titulo.imdb} rt={titulo.rt} />

      {titulo.linha ? <span className={styles.linha}>{titulo.linha}</span> : null}
    </article>
  );
}
