import type { ReactNode } from 'react';
import type { CardDeTitulo } from '../api/tipos';
import { RatingBadges } from './RatingBadges';
import { SeloDePessoa } from './SeloDePessoa';
import styles from './PosterCard.module.scss';

/**
 * O card de pôster do §12 — **o único card de trilha do app**.
 *
 * "Todos os cards de trilha são idênticos; só o conteúdo muda", e desde
 * 23/09/2026 isso vale também no desktop (§3): o card horizontal que o modelo
 * `desktop-catflix.html` propunha para pré-estreias foi descartado porque o app
 * é usado majoritariamente no celular, e duas formas de card significariam duas
 * formas de errar.
 *
 * Desde 20/11/2026 o card é uma caixa só: pôster em cima, com o título por
 * cima da imagem, e um rodapé com as notas à esquerda e a faixa (data,
 * urgência) numa pílula à direita; embaixo, uma linha de texto. O card ocupa a
 * largura que o contêiner der — na grade, a coluna inteira; na trilha, a
 * largura fixa que a esteira define.
 */
export function PosterCard({
  titulo,
  aoAbrir,
  notas,
  rodape,
}: {
  titulo: CardDeTitulo;
  aoAbrir?: (id: string) => void;
  /** substitui as notas do IMDb/RT — nos Assistidos, a nota de cada um */
  notas?: ReactNode;
  /** substitui a linha de texto — nos Assistidos, os comentários */
  rodape?: ReactNode;
}) {
  const descricao = [
    titulo.titulo,
    titulo.ano ? `de ${titulo.ano}` : null,
    titulo.linha,
    titulo.faixa,
  ]
    .filter(Boolean)
    .join(', ');

  const resumo = notas ?? <RatingBadges imdb={titulo.imdb} rt={titulo.rt} />;
  const temNotas = Boolean(notas) || Boolean(titulo.imdb || titulo.rt);
  const embaixo = rodape ?? (titulo.linha ? <span className={styles.linha}>{titulo.linha}</span> : null);

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

          {/* quem quer assistir (lista de cada um): os dois rostos se enfileiram */}
          {titulo.marcadoPor.length > 0 ? (
            <span className={styles.marcas}>
              {titulo.marcadoPor.map((marca) => (
                <SeloDePessoa
                  key={marca.userId}
                  perfilId={marca.userId}
                  acento={marca.acento}
                  rotulo={`Na lista de ${marca.nome}`}
                />
              ))}
            </span>
          ) : null}

          <span className={styles.nome}>{titulo.titulo}</span>
        </div>
      </button>

      {temNotas || titulo.faixa || embaixo ? (
        <div className={styles.rodape}>
          {temNotas || titulo.faixa ? (
            <div className={styles.resumo}>
              {temNotas ? resumo : null}
              {titulo.faixa ? <span className={styles.faixa}>{titulo.faixa}</span> : null}
            </div>
          ) : null}

          {embaixo}
        </div>
      ) : null}
    </article>
  );
}
