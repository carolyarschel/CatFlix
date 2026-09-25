import { useCallback, useMemo, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import type { FilaDeRevisao, ItemDaFila, MotivoDeRevisao } from '../../shared/api/tipos';
import { IconeVoltar } from '../../shared/components/Icones';
import { useApi } from '../../shared/hooks/useApi';
import { TrocarFilme } from './TrocarFilme';
import styles from './RevisarPage.module.scss';

/**
 * Fila de revisão (§10 e modelo `mobile-revisar.html`).
 *
 * A tela existe por causa da regra do §2: nenhum match duvidoso é aceito em
 * silêncio. Cada card mostra o evento como veio do ingresso, o score com a
 * composição resumida, e o candidato do TMDB — para a decisão ser tomada
 * olhando os dois lados, não confiando num número.
 */

const ROTULO_DO_MOTIVO: Record<MotivoDeRevisao, string> = {
  low_confidence: 'Confiança baixa',
  no_candidate: 'Sem candidato',
  possible_duplicate: 'Possível duplicata',
  probable_non_film: 'Provavelmente não é filme',
};

export function RevisarPage({ aoVoltar }: { aoVoltar: () => void }) {
  const [motivo, setMotivo] = useState<MotivoDeRevisao | null>(null);
  const [trocando, setTrocando] = useState<ItemDaFila | null>(null);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const query = useMemo(() => (motivo ? { motivo } : {}), [motivo]);
  const fila = useApi<FilaDeRevisao>('/review', { query });

  const recarregar = fila.recarregar;

  /**
   * Toda resolução recarrega a fila inteira em vez de tirar o card da lista.
   *
   * Parece desperdício e não é: resolver uma pendência pode **criar outra** —
   * confirmar um candidato que já pertence a outro Title gera um
   * `possible_duplicate`. Tirar o card da tela esconderia a pendência nova até
   * a próxima visita.
   */
  const resolver = useCallback(
    async (id: string, caminho: string, corpo?: unknown) => {
      setResolvendo(id);
      setErro(null);
      try {
        await api.post(`/review/${id}/${caminho}`, corpo);
        recarregar();
      } catch (problema) {
        setErro(
          problema instanceof ApiError ? problema.message : 'Não consegui resolver a pendência.',
        );
      } finally {
        setResolvendo(null);
      }
    },
    [recarregar],
  );

  const dados = fila.dados;
  const total = dados?.porMotivo.reduce((n, m) => n + m.quantidade, 0) ?? 0;

  return (
    <div className={styles.tela}>
      <header className={styles.cabecalho}>
        <div className={styles.linha}>
          <button type="button" className={styles.voltar} aria-label="Voltar" onClick={aoVoltar}>
            <IconeVoltar tamanho={19} />
          </button>
          <h1 className={styles.titulo}>Fila de revisão</h1>
        </div>
        <p className={styles.explicacao}>
          Sessões que o matcher não ligou a um filme com confiança suficiente. Nada é descartado:
          até resolver, o título aparece no app com aviso de metadata pendente.
        </p>
      </header>

      {dados ? (
        <div className={styles.filtros} role="group" aria-label="Filtrar por motivo">
          <button
            type="button"
            className={motivo === null ? `${styles.filtro} ${styles.ativo}` : styles.filtro}
            aria-pressed={motivo === null}
            onClick={() => setMotivo(null)}
          >
            Tudo ({total})
          </button>
          {dados.porMotivo.map((m) => (
            <button
              key={m.motivo}
              type="button"
              className={motivo === m.motivo ? `${styles.filtro} ${styles.ativo}` : styles.filtro}
              aria-pressed={motivo === m.motivo}
              onClick={() => setMotivo(m.motivo)}
            >
              {ROTULO_DO_MOTIVO[m.motivo]} ({m.quantidade})
            </button>
          ))}
        </div>
      ) : null}

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      <div className={styles.lista}>
        {fila.carregando && !dados ? <p className={styles.vazio}>Carregando…</p> : null}

        {fila.erro ? (
          <p className={styles.vazio} role="alert">
            {fila.erro}
          </p>
        ) : null}

        {dados && dados.itens.length === 0 ? (
          <p className={styles.vazio}>
            Nada pendente. Tudo o que o ingresso publicou está ligado a um filme.
          </p>
        ) : null}

        {dados?.itens.map((item) => (
          <CardDaFila
            key={item.id}
            item={item}
            ocupado={resolvendo === item.id}
            aoConfirmar={() => void resolver(item.id, 'confirm')}
            aoTrocar={() => setTrocando(item)}
            aoNaoEhFilme={() => void resolver(item.id, 'not-a-film')}
            aoDispensar={() => void resolver(item.id, 'dismiss')}
          />
        ))}
      </div>

      {trocando ? (
        <TrocarFilme
          item={trocando}
          aoFechar={() => setTrocando(null)}
          aoEscolher={async (tmdbId) => {
            const id = trocando.id;
            setTrocando(null);
            await resolver(id, 'replace', { tmdbId });
          }}
        />
      ) : null}
    </div>
  );
}

function CardDaFila({
  item,
  ocupado,
  aoConfirmar,
  aoTrocar,
  aoNaoEhFilme,
  aoDispensar,
}: {
  item: ItemDaFila;
  ocupado: boolean;
  aoConfirmar: () => void;
  aoTrocar: () => void;
  aoNaoEhFilme: () => void;
  aoDispensar: () => void;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.bloco}>
        <span className={styles.rotulo}>Evento no ingresso</span>
        <span className={styles.nome}>{item.eventoTitulo}</span>
        {item.eventoMeta ? <span className={styles.meta}>{item.eventoMeta}</span> : null}
      </div>

      <div className={styles.linhaDeScore}>
        {/* "score" escrito por extenso: um "1,00" solto ao lado de
            "Provavelmente não é filme" parecia dizer o contrário do que diz —
            é a certeza de QUAL título é, não de que seja um filme */}
        <span className={styles.score}>score {formatarScore(item.score)}</span>
        <span className={styles.motivo}>{ROTULO_DO_MOTIVO[item.motivo]}</span>
      </div>

      {item.explicacao ? <p className={styles.explicacaoDoMatcher}>{item.explicacao}</p> : null}

      <div className={styles.divisor} />

      <div className={styles.bloco}>
        <span className={styles.rotulo}>Candidato TMDB</span>
        {item.temCandidato ? (
          <>
            <span className={styles.nome}>{item.candidatoTitulo}</span>
            {item.candidatoMeta ? <span className={styles.meta}>{item.candidatoMeta}</span> : null}
          </>
        ) : (
          <span className={styles.meta}>
            Nenhum candidato passou do limiar. Busque o filme certo em “Trocar”, ou marque o que
            for o caso.
          </span>
        )}
      </div>

      <div className={styles.acoes}>
        {/* sem candidato não há o que confirmar: o botão primário some em vez
            de ficar cinza pedindo para ser clicado */}
        {item.temCandidato ? (
          <button type="button" className={styles.primaria} disabled={ocupado} onClick={aoConfirmar}>
            Confirmar
          </button>
        ) : null}
        <button type="button" className={styles.secundaria} disabled={ocupado} onClick={aoTrocar}>
          Trocar
        </button>
        <button type="button" className={styles.secundaria} disabled={ocupado} onClick={aoNaoEhFilme}>
          Não é filme
        </button>
        {/* acréscimo ao §10: filme de verdade que o TMDB não tem ficaria na
            fila para sempre sem esta saída */}
        <button type="button" className={styles.secundaria} disabled={ocupado} onClick={aoDispensar}>
          Sem ficha
        </button>
      </div>
    </article>
  );
}

/** "0,81" — vírgula decimal, como o resto do app. Sem score, um traço. */
function formatarScore(score: number | null): string {
  if (score === null) return '—';
  return score.toFixed(2).replace('.', ',');
}
