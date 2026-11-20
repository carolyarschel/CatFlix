import { useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { IconeIngresso } from '../../shared/components/Icones';
import { formatarDia } from '../../shared/dias';
import type { IngressoComprado, RespostaDaVisualizacao } from '../../shared/api/tipos';
import styles from './CarrosselDeIngressos.module.scss';

/**
 * O destaque da aba Cinema quando há ingresso comprado (pedido de 20/11/2026):
 * um carrossel com um card por ingresso — filme, cinema, horário e códigos de
 * resgate — e o botão "Marcar como assistido", que registra os dois, no
 * cinema, no dia da sessão.
 *
 * Marcado, o ingresso sai do carrossel. O aviso que fica embaixo oferece o
 * desfazer: apaga a visualização e devolve o filme à lista de quem estava,
 * e o ingresso volta.
 *
 * Sem ingresso, mostra `semIngressos` (o destaque de sempre). O componente
 * fica montado nos dois casos para o "Desfazer" sobreviver à saída do último
 * ingresso.
 */
export function CarrosselDeIngressos({
  ingressos,
  aoAbrirFilme,
  aoMudar,
  semIngressos,
}: {
  ingressos: IngressoComprado[];
  semIngressos?: ReactNode;
  aoAbrirFilme: (titleId: string) => void;
  /** algo mudou no servidor: recarregar ingressos e home */
  aoMudar: () => void;
}) {
  const trilho = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcado, setMarcado] = useState<{ titulo: string; resposta: RespostaDaVisualizacao } | null>(null);

  function aoRolar() {
    const el = trilho.current;
    if (!el || !el.firstElementChild) return;
    const passo = (el.firstElementChild as HTMLElement).offsetWidth + 12;
    setAtual(Math.min(ingressos.length - 1, Math.round(el.scrollLeft / passo)));
  }

  function irPara(indice: number) {
    const el = trilho.current;
    const alvo = el?.children[indice] as HTMLElement | undefined;
    if (el && alvo) el.scrollTo({ left: alvo.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  }

  async function marcar(ingresso: IngressoComprado) {
    const comecou = new Date(ingresso.inicio).getTime() <= Date.now();
    if (!comecou && !window.confirm('A sessão ainda não começou. Marcar como assistido mesmo assim?')) return;

    setMarcando(ingresso.id);
    setErro(null);
    try {
      const resposta = await api.post<RespostaDaVisualizacao>(`/tickets/${ingresso.id}/assistido`, {});
      setMarcado({ titulo: ingresso.filme.titulo, resposta });
      aoMudar();
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui marcar como assistido.');
    } finally {
      setMarcando(null);
    }
  }

  async function desfazer() {
    if (!marcado) return;
    const { resposta } = marcado;
    setMarcado(null);
    try {
      await api.delete(`/watches/${resposta.visualizacao.id}`);
      if (resposta.removidosDaLista.length > 0) {
        await api.post('/watchlist/restaurar', { ids: resposta.removidosDaLista.map((r) => r.id) });
      }
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui desfazer.');
    } finally {
      aoMudar();
    }
  }

  return (
    <section
      className={styles.carrossel}
      aria-label={ingressos.length > 0 ? 'Ingressos comprados' : undefined}
      aria-roledescription={ingressos.length > 0 ? 'carrossel' : undefined}
    >
      {ingressos.length === 0 ? semIngressos : null}

      {ingressos.length > 0 ? (
        <div
          ref={trilho}
          className={ingressos.length > 1 ? `${styles.trilho} ${styles.varios}` : styles.trilho}
          onScroll={aoRolar}
        >
          {ingressos.map((ingresso, i) => (
            <CardDoIngresso
              key={ingresso.id}
              ingresso={ingresso}
              posicao={`${i + 1} de ${ingressos.length}`}
              marcando={marcando === ingresso.id}
              aoAbrirFilme={() => aoAbrirFilme(ingresso.titleId)}
              aoMarcar={() => void marcar(ingresso)}
            />
          ))}
        </div>
      ) : null}

      {ingressos.length > 1 ? (
        <div className={styles.pontos} role="group" aria-label="Escolher ingresso">
          {ingressos.map((ingresso, i) => (
            <button
              key={ingresso.id}
              type="button"
              className={i === atual ? `${styles.ponto} ${styles.pontoAtual}` : styles.ponto}
              aria-label={`Ingresso ${i + 1}: ${ingresso.filme.titulo}`}
              aria-current={i === atual}
              onClick={() => irPara(i)}
            />
          ))}
        </div>
      ) : null}

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      {marcado ? (
        <p className={styles.aviso} role="status">
          <span>
            <strong>{marcado.titulo}</strong> foi para os Assistidos.
          </span>
          <button type="button" className={styles.desfazer} onClick={() => void desfazer()}>
            Desfazer
          </button>
        </p>
      ) : null}
    </section>
  );
}

function CardDoIngresso({
  ingresso,
  posicao,
  marcando,
  aoAbrirFilme,
  aoMarcar,
}: {
  ingresso: IngressoComprado;
  posicao: string;
  marcando: boolean;
  aoAbrirFilme: () => void;
  aoMarcar: () => void;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(codigo);
      window.setTimeout(() => setCopiado((c) => (c === codigo ? null : c)), 1800);
    } catch {
      // sem área de transferência: o código está à vista
    }
  }

  return (
    <article className={styles.card} aria-roledescription="slide" aria-label={posicao}>
      <button
        type="button"
        className={styles.palco}
        onClick={aoAbrirFilme}
        aria-label={`Abrir ${ingresso.filme.titulo}`}
      >
        {ingresso.filme.posterUrl ? (
          <img className={styles.imagem} src={ingresso.filme.posterUrl} alt="" decoding="async" />
        ) : null}
        <span className={styles.selo}>
          <IconeIngresso tamanho={15} traco={2} />
          Ingresso comprado
        </span>
        <h2 className={styles.titulo}>{ingresso.filme.titulo}</h2>
      </button>

      <div className={styles.rodape}>
        <div className={styles.sessao}>
          <div className={styles.onde}>
            <span className={styles.cinema}>{ingresso.cinema}</span>
            {ingresso.detalhes ? <span className={styles.detalhes}>{ingresso.detalhes}</span> : null}
          </div>
          <div className={styles.quando}>
            <span className={styles.dia}>{formatarDia(ingresso.dia)}</span>
            <span className={styles.hora}>{ingresso.horario}</span>
          </div>
        </div>

        {ingresso.codigos.length > 0 ? (
          <ul className={styles.codigos} aria-label="Códigos de resgate">
            {ingresso.codigos.map((codigo) => (
              <li key={codigo} className={styles.codigo}>
                <code className={styles.textoDoCodigo}>{codigo}</code>
                <button
                  type="button"
                  className={styles.copiar}
                  onClick={() => void copiar(codigo)}
                  aria-label={`Copiar o código ${codigo}`}
                >
                  {copiado === codigo ? 'Copiado' : 'Copiar'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.semCodigo}>Nenhum código de resgate cadastrado.</p>
        )}

        <button type="button" className={styles.assistido} onClick={aoMarcar} disabled={marcando}>
          {marcando ? 'Marcando…' : 'Marcar como assistido'}
        </button>
      </div>
    </article>
  );
}
