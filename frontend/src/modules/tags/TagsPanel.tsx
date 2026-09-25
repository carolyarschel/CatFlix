import { useEffect, useRef } from 'react';
import { useApi } from '../../shared/hooks/useApi';
import type { Facetas } from '../../shared/api/tipos';
import styles from './TagsPanel.module.scss';

/**
 * Painel de tags (§12): desliza da direita sobre a home escurecida, agrupado
 * por faceta, com contagem por item e o item ativo destacado no acento do
 * perfil. Segue o modelo `mobile-tags.html`.
 *
 * **Seleção múltipla.** O modelo desenha só uma tag ligada, mas o backend soma
 * as tags com E (`?tag=sala:imax&tag=audio:legendado` = IMAX *e* legendado), e
 * "IMAX legendado" é exatamente a pergunta que se faz na frente do cinema.
 * Cada item é um `aria-pressed`, não um rádio.
 *
 * O painel **não** filtra nada sozinho: ele devolve a seleção para a home, que
 * é quem troca as trilhas pela lista filtrada. Assim a contagem que o item
 * mostra e o resultado que aparece vêm da mesma fonte.
 */
export function TagsPanel({
  selecionadas,
  aoAlternar,
  aoLimpar,
  aoFechar,
}: {
  /** ids qualificados: `sala:imax` */
  selecionadas: string[];
  aoAlternar: (id: string) => void;
  aoLimpar: () => void;
  aoFechar: () => void;
}) {
  // `emCartaz=1`: filtrar por uma sala que só existe em filme de dezembro
  // devolveria lista vazia sem explicação (é o que a rota do §10 documenta)
  const facetas = useApi<Facetas>('/tags', { query: { emCartaz: '1' } });

  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    // Esc fecha. No celular quem fecha é o toque fora ou o X; no desktop, sem
    // isto, o painel vira uma armadilha de teclado.
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') fechar.current();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const grupos = facetas.dados?.grupos ?? [];

  return (
    <div className={styles.fundo} onClick={aoFechar} role="presentation">
      <aside
        className={styles.painel}
        role="dialog"
        aria-modal="true"
        aria-label="Filtrar por tag"
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className={styles.cabecalho}>
          <h2 className={styles.titulo}>Tags</h2>

          <div className={styles.acoes}>
            {selecionadas.length > 0 ? (
              <button type="button" className={styles.limpar} onClick={aoLimpar}>
                Limpar
              </button>
            ) : null}

            <button
              type="button"
              className={styles.fechar}
              aria-label="Fechar painel"
              onClick={aoFechar}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className={styles.lista}>
          {facetas.carregando && !facetas.dados ? (
            <p className={styles.aviso}>Carregando…</p>
          ) : null}

          {facetas.erro ? (
            <div className={styles.aviso} role="alert">
              <p>{facetas.erro}</p>
              <button type="button" className={styles.tentar} onClick={facetas.recarregar}>
                Tentar de novo
              </button>
            </div>
          ) : null}

          {facetas.dados && grupos.length === 0 ? (
            <p className={styles.aviso}>
              Nenhuma tag ainda. Elas nascem das sessões: rode um sync para popular.
            </p>
          ) : null}

          {grupos.map((grupo) => (
            <section key={grupo.facet} className={styles.grupo}>
              <h3 className={styles.rotulo}>{grupo.rotulo}</h3>

              {grupo.itens.map((item) => {
                const ativa = selecionadas.includes(item.id);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={ativa ? `${styles.item} ${styles.ativa}` : styles.item}
                    aria-pressed={ativa}
                    onClick={() => aoAlternar(item.id)}
                  >
                    <span className={styles.nome}>{item.label}</span>
                    <span className={styles.contagem}>{item.titulos}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
