import { useEffect, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import type { CandidatoDoTmdb, ItemDaFila } from '../../shared/api/tipos';
import styles from './TrocarFilme.module.scss';

/**
 * Busca no TMDB para trocar o candidato de uma pendência (§10,
 * `GET /review/buscar`).
 *
 * A busca sai do backend, nunca do navegador (§5.1): a chave do TMDB não pode
 * chegar ao celular.
 */
export function TrocarFilme({
  item,
  aoFechar,
  aoEscolher,
}: {
  item: ItemDaFila;
  aoFechar: () => void;
  aoEscolher: (tmdbId: number) => Promise<void>;
}) {
  // começa com o título do evento: quase sempre é o termo certo, só sujo de
  // sufixo — e ver o termo preenchido ensina o que a normalização faz
  const [termo, setTermo] = useState(item.eventoTitulo);
  const [resultados, setResultados] = useState<CandidatoDoTmdb[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    if (!termo.trim()) return;

    const controller = new AbortController();
    setBuscando(true);

    api
      .get<{ resultados: CandidatoDoTmdb[] }>('/review/buscar', {
        query: { q: termo },
        signal: controller.signal,
      })
      .then((resposta) => {
        if (controller.signal.aborted) return;
        setResultados(resposta.resultados);
        setErro(resposta.resultados.length === 0 ? 'O TMDB não achou nada com esse termo.' : null);
      })
      .catch((problema: unknown) => {
        if (controller.signal.aborted) return;
        setErro(problema instanceof ApiError ? problema.message : 'A busca falhou.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBuscando(false);
      });

    return () => controller.abort();
    // a busca é disparada à mão, não a cada tecla: cada consulta gasta uma
    // chamada ao TMDB, e digitar "Duna" custaria quatro
  }, [gatilho]);

  return (
    <div className={styles.fundo} onClick={aoFechar} role="presentation">
      <div
        className={styles.painel}
        role="dialog"
        aria-label="Trocar o filme da pendência"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.puxador} aria-hidden="true" />

        <p className={styles.evento}>{item.eventoTitulo}</p>

        <form
          className={styles.busca}
          onSubmit={(e) => {
            e.preventDefault();
            setGatilho((n) => n + 1);
          }}
        >
          <input
            className={styles.campo}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            aria-label="Buscar no TMDB"
            autoFocus
          />
          <button type="submit" className={styles.buscar} disabled={buscando || !termo.trim()}>
            {buscando ? '…' : 'Buscar'}
          </button>
        </form>

        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        <ul className={styles.resultados}>
          {resultados.map((candidato) => (
            <li key={candidato.tmdbId}>
              <button
                type="button"
                className={styles.resultado}
                onClick={() => void aoEscolher(candidato.tmdbId)}
              >
                {candidato.posterUrl ? (
                  <img className={styles.poster} src={candidato.posterUrl} alt="" loading="lazy" />
                ) : (
                  <span className={styles.semPoster} aria-hidden="true" />
                )}
                <span className={styles.texto}>
                  <span className={styles.nome}>{candidato.titulo}</span>
                  <span className={styles.meta}>
                    {[
                      candidato.ano,
                      candidato.tituloOriginal !== candidato.titulo
                        ? candidato.tituloOriginal
                        : null,
                      `TMDB ${candidato.tmdbId}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className={styles.fechar} onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
