import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { IconeVoltar } from '../../shared/components/Icones';
import type { EstadoDaImportacao, RelatorioDaImportacao } from '../../shared/api/tipos';
import styles from './ImportarCgPage.module.scss';

/**
 * Importar o histórico do Crônicas de Gatur antigo (cineon-expansao §11) pela
 * própria tela — sem SSH no servidor.
 *
 * Três passos, e o primeiro não grava nada:
 * 1. escolher o arquivo do dump → o servidor lê os filmes e busca cada um no
 *    TMDB (simulação, um ou dois minutos);
 * 2. ler o relatório: o que casou, o que vai para a fila Revisar, os avisos;
 * 3. "Aplicar" grava. Aplicar de novo, ou importar o mesmo arquivo outra vez,
 *    não duplica nada.
 *
 * O servidor não guarda o arquivo, só os filmes lidos dele, e só na memória
 * até a importação terminar.
 */

const INTERVALO_MS = 1500;

export function ImportarCgPage({
  aoVoltar,
  aoNavegar,
}: {
  aoVoltar: () => void;
  aoNavegar: (para: string) => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<EstadoDaImportacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const andando = estado?.fase === 'casando' || estado?.fase === 'aplicando';

  // acompanha a tarefa enquanto ela roda no servidor
  useEffect(() => {
    if (!estado || !andando) return;
    const id = estado.id;
    const relogio = window.setInterval(() => {
      api
        .get<EstadoDaImportacao>(`/importacao/cg/${id}`)
        .then(setEstado)
        .catch((problema: unknown) => {
          setErro(problema instanceof ApiError ? problema.message : 'Perdi o contato com o servidor.');
          window.clearInterval(relogio);
        });
    }, INTERVALO_MS);
    return () => window.clearInterval(relogio);
  }, [estado?.id, andando]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar() {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      // o corpo é o arquivo cru; o `api` do app manda JSON, então aqui é fetch
      const resposta = await fetch('/api/importacao/cg', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: arquivo,
        credentials: 'same-origin',
      });
      const corpo = (await resposta.json()) as EstadoDaImportacao & { error?: { message: string } };
      if (!resposta.ok) throw new Error(corpo.error?.message ?? `Falha no envio (${resposta.status}).`);
      setEstado(corpo);
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : 'O envio falhou.');
    } finally {
      setEnviando(false);
    }
  }

  async function aplicar() {
    if (!estado) return;
    const t = estado.relatorio?.totais;
    const confirmar = window.confirm(
      `Gravar ${t?.filmes ?? ''} filmes no acervo de vocês? ${t?.duvidas ?? 0} vão para a fila Revisar.`,
    );
    if (!confirmar) return;
    setErro(null);
    try {
      setEstado(await api.post<EstadoDaImportacao>(`/importacao/cg/${estado.id}/aplicar`));
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui aplicar.');
    }
  }

  function recomecar() {
    setEstado(null);
    setArquivo(null);
    setErro(null);
    if (campo.current) campo.current.value = '';
  }

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
          <IconeVoltar />
        </button>
        <h1 className={styles.titulo}>Importar do Crônicas de Gatur</h1>
      </header>

      <main className={styles.conteudo}>
        {!estado ? (
          <section className={styles.cartao}>
            <p>
              Escolha o arquivo do <strong>dump do banco do CG</strong> (o <code>.sql</code> do{' '}
              <code>pg_dump</code>). Primeiro vem uma <strong>simulação</strong>: nada é gravado até você
              apertar "Aplicar".
            </p>
            <p className={styles.miudo}>
              Só os filmes são lidos. O arquivo não fica guardado no servidor.
            </p>
            <input
              ref={campo}
              className={styles.arquivo}
              type="file"
              accept=".sql,.txt,text/plain"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              aria-label="Arquivo do dump do Crônicas de Gatur"
            />
            <button type="button" className={styles.primario} disabled={!arquivo || enviando} onClick={() => void enviar()}>
              {enviando ? 'Enviando…' : 'Simular a importação'}
            </button>
          </section>
        ) : null}

        {estado && andando ? (
          <section className={styles.cartao} role="status" aria-live="polite">
            <p className={styles.fase}>
              {estado.fase === 'casando' ? 'Procurando cada filme no TMDB…' : 'Gravando no acervo…'}
            </p>
            <div className={styles.barra} aria-hidden="true">
              <span style={{ width: `${(100 * estado.feitos) / Math.max(estado.total, 1)}%` }} />
            </div>
            <p className={styles.miudo}>
              {estado.feitos} de {estado.total} filmes. Pode deixar a tela aberta.
            </p>
          </section>
        ) : null}

        {estado?.fase === 'erro' ? (
          <section className={styles.cartao} role="alert">
            <p>A importação parou: {estado.erro}</p>
            {estado.relatorio || estado.feitos === estado.total ? (
              <button type="button" className={styles.primario} onClick={() => void aplicar()}>
                Tentar aplicar de novo
              </button>
            ) : null}
            <button type="button" className={styles.secundario} onClick={recomecar}>
              Começar de novo
            </button>
          </section>
        ) : null}

        {estado?.fase === 'aplicado' ? (
          <section className={`${styles.cartao} ${styles.feito}`} role="status">
            <p className={styles.fase}>Importação aplicada.</p>
            <p>
              {estado.relatorio?.totais.jaImportados
                ? `${estado.relatorio.totais.jaImportados} filmes já tinham sido importados antes e foram pulados.`
                : 'Os filmes do CG já estão no acervo de vocês.'}
            </p>
            <div className={styles.acoes}>
              <button type="button" className={styles.primario} onClick={() => aoNavegar('/assistidos')}>
                Ver os assistidos
              </button>
              {(estado.relatorio?.revisao.length ?? 0) > 0 ? (
                <button type="button" className={styles.secundario} onClick={() => aoNavegar('/revisar')}>
                  Abrir a fila Revisar ({estado.relatorio?.revisao.length})
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {estado?.fase === 'pronto' ? (
          <section className={styles.cartao}>
            <p className={styles.fase}>Simulação pronta. Nada foi gravado ainda.</p>
            <div className={styles.acoes}>
              <button type="button" className={styles.primario} onClick={() => void aplicar()}>
                Aplicar importação
              </button>
              <button type="button" className={styles.secundario} onClick={recomecar}>
                Escolher outro arquivo
              </button>
            </div>
          </section>
        ) : null}

        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        {estado?.relatorio ? <Relatorio r={estado.relatorio} /> : null}
      </main>
    </div>
  );
}

function Relatorio({ r }: { r: RelatorioDaImportacao }) {
  const t = r.totais;
  const numeros: Array<[string, number]> = [
    ['Filmes', t.filmes],
    ['Casaram com o TMDB', t.certos],
    ['Vão para a fila Revisar', t.duvidas + t.semCandidato],
    ['Visualizações', t.visualizacoes],
    ['Na lista "quero assistir"', t.lista],
    ['Notas', t.notas],
    ['Comentários', t.comentarios],
    ['Favoritos', t.favoritos],
  ];

  return (
    <>
      <section className={styles.secao}>
        <h2 className={styles.rotulo}>O que entra</h2>
        <dl className={styles.numeros}>
          {numeros.map(([rotulo, valor]) => (
            <div key={rotulo} className={styles.numero}>
              <dt>{rotulo}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      {r.revisao.length > 0 ? (
        <section className={styles.secao}>
          <h2 className={styles.rotulo}>Vão para a fila Revisar</h2>
          <p className={styles.miudo}>Entram no acervo agora, e você escolhe o filme certo do TMDB na fila.</p>
          <ul className={styles.lista}>
            {r.revisao.map((x, i) => (
              <li key={i}>
                <strong>{x.titulo}</strong>
                {x.lancamento ? ` (${x.lancamento.slice(0, 4)})` : ''}
                <span className={styles.miudo}>
                  {x.candidato ? `Candidato: ${x.candidato.titulo} (${x.candidato.ano ?? '?'}). ` : ''}
                  {x.motivo}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.repetidos.length > 0 ? (
        <section className={styles.secao}>
          <h2 className={styles.rotulo}>Repetidos no CG</h2>
          <p className={styles.miudo}>Viram um filme só. Quem assistiu por um registro não fica na lista pelo outro.</p>
          <ul className={styles.lista}>
            {r.repetidos.map((x) => (
              <li key={x.tmdbId}>
                <strong>{x.titulo}</strong>
                <span className={styles.miudo}>{x.itens.join(' | ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.avisos.length > 0 ? (
        <section className={styles.secao}>
          <h2 className={styles.rotulo}>Avisos</h2>
          <ul className={styles.lista}>
            {r.avisos.map((x, i) => (
              <li key={i}>
                <strong>{x.titulo}</strong>
                <span className={styles.miudo}>{x.avisos.join('; ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className={styles.secao}>
        <summary className={styles.rotulo}>Casaram com o TMDB ({r.certos.length})</summary>
        <ul className={styles.lista}>
          {/* a posição como chave: os repetidos do CG geram linhas idênticas */}
          {r.certos.map((x, i) => (
            <li key={i}>
              <strong>{x.titulo}</strong>
              <span className={styles.miudo}>
                {x.resumo || '—'} · {x.como}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
