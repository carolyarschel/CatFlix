import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { IconeBusca, IconeVoltar } from '../../shared/components/Icones';
import { PESSOA_DO_PERFIL, outraPessoa, perfilDaPessoa } from '../../shared/pessoas';
import { useApi } from '../../shared/hooks/useApi';
import type {
  DadosDaVisualizacao,
  PerfilDoApp,
  RespostaDaVisualizacao,
  ResultadoDaBusca,
} from '../../shared/api/tipos';
import { FormularioDeVisualizacao } from './FormularioDeVisualizacao';
import styles from './AdicionarPage.module.scss';

/**
 * O botão "+" (cineon-expansao §4.1): busca no TMDB e põe o filme no acervo.
 *
 * Fluxo: buscar → escolher → "Já assistimos", "Quero assistir" ou só abrir o
 * detalhe → confirmação. É uma página, e não uma janela por cima, para o
 * voltar do Android desfazer um passo em vez de fechar o app.
 *
 * **Nunca duplica:** o backend reaproveita o filme que já entrou pelo cinema
 * (`POST /library/titles`), e o resultado da busca já diz "No catálogo".
 *
 * Não há "nenhum resultado, cria assim mesmo" (§4.1). O que existe é o link
 * discreto "Não encontrei o filme" (§3.5), depois de uma busca: o filme entra
 * só com título e ano, sem TMDB, e vai para a fila Revisar para ser ligado ao
 * TMDB quando existir lá. Ele só é criado quando a pessoa escolhe o que fazer
 * com ele — voltar antes disso não deixa nada no banco.
 */

const ESPERA_DA_DIGITACAO_MS = 400;
const MINIMO_DE_LETRAS = 2;

/** Um resultado da busca, ou o filme digitado à mão (`manual`, sem TMDB). */
type Filme = ResultadoDaBusca & { manual?: boolean };

type Etapa =
  | { tipo: 'buscar' }
  | { tipo: 'manual' }
  | { tipo: 'opcoes'; filme: Filme }
  | { tipo: 'assistimos'; filme: Filme }
  | { tipo: 'feito'; filme: Filme; titleId: string; mensagem: string; removidos: string[] };

export function AdicionarPage({
  perfil,
  aoVoltar,
  aoAbrir,
}: {
  perfil: PerfilDoApp;
  aoVoltar: () => void;
  aoAbrir: (titleId: string) => void;
}) {
  const eu = PESSOA_DO_PERFIL[perfil.id] ?? 'CAT';
  const perfis = useApi<{ itens: PerfilDoApp[] }>('/users');
  const nomeDoOutro = perfis.dados ? perfilDaPessoa(perfis.dados.itens, outraPessoa(eu))?.nome : null;

  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ResultadoDaBusca[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null);

  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'buscar' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desfeito, setDesfeito] = useState(false);

  const campo = useRef<HTMLInputElement>(null);
  // o filme manual já criado: se a ação seguinte falhar, tentar de novo não cria outro
  const manualCriado = useRef<{ filme: Filme; titleId: string } | null>(null);

  // busca com debounce: cada consulta é uma chamada ao TMDB pelo backend
  useEffect(() => {
    const q = termo.trim();
    if (q.length < MINIMO_DE_LETRAS) {
      setResultados(null);
      setErroDaBusca(null);
      return;
    }

    const controller = new AbortController();
    const espera = window.setTimeout(() => {
      setBuscando(true);
      api
        .get<{ itens: ResultadoDaBusca[] }>('/tmdb/search', { query: { q }, signal: controller.signal })
        .then((r) => {
          setResultados(r.itens);
          setErroDaBusca(null);
        })
        .catch((problema: unknown) => {
          if (controller.signal.aborted) return;
          setErroDaBusca(problema instanceof ApiError ? problema.message : 'A busca falhou.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setBuscando(false);
        });
    }, ESPERA_DA_DIGITACAO_MS);

    return () => {
      window.clearTimeout(espera);
      controller.abort();
    };
  }, [termo]);

  /** O id do filme no catálogo: o que já existe, ou o que o "+" acabou de criar. */
  async function garantirTitulo(filme: Filme): Promise<string> {
    if (filme.titleId) return filme.titleId;
    if (filme.manual) {
      if (manualCriado.current?.filme === filme) return manualCriado.current.titleId;
      const r = await api.post<{ titleId: string }>('/library/titles/manual', { titulo: filme.titulo, ano: filme.ano });
      manualCriado.current = { filme, titleId: r.titleId };
      return r.titleId;
    }
    const r = await api.post<{ titleId: string }>('/library/titles', { tmdbId: filme.tmdbId });
    // a busca na tela passa a saber que ele está no catálogo
    setResultados((atuais) =>
      atuais?.map((x) => (x.tmdbId === filme.tmdbId ? { ...x, titleId: r.titleId } : x)) ?? null,
    );
    return r.titleId;
  }

  async function executar(acao: () => Promise<void>) {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  function querAssistir(filme: Filme, paraOsDois: boolean) {
    void executar(async () => {
      const titleId = await garantirTitulo(filme);
      await api.put(`/titles/${titleId}/watchlist`, { paraOsDois });
      setEtapa({
        tipo: 'feito',
        filme,
        titleId,
        mensagem: paraOsDois ? 'Na lista de vocês dois.' : 'Na sua lista.',
        removidos: [],
      });
    });
  }

  function abrirDetalhe(filme: Filme) {
    void executar(async () => aoAbrir(await garantirTitulo(filme)));
  }

  function registrar(filme: Filme, dados: DadosDaVisualizacao) {
    void executar(async () => {
      const titleId = await garantirTitulo(filme);
      const r = await api.post<RespostaDaVisualizacao>(`/titles/${titleId}/watches`, dados);
      setDesfeito(false);
      setEtapa({
        tipo: 'feito',
        filme,
        titleId,
        mensagem: 'Registrado no acervo de vocês.',
        removidos: r.removidosDaLista.map((x) => x.id),
      });
    });
  }

  function desfazerRemocaoDaLista(ids: string[]) {
    void executar(async () => {
      await api.post('/watchlist/restaurar', { ids });
      setDesfeito(true);
    });
  }

  function voltarUmPasso() {
    setErro(null);
    if (etapa.tipo === 'assistimos') return setEtapa({ tipo: 'opcoes', filme: etapa.filme });
    if (etapa.tipo === 'opcoes') return setEtapa(etapa.filme.manual ? { tipo: 'manual' } : { tipo: 'buscar' });
    if (etapa.tipo === 'manual') return setEtapa({ tipo: 'buscar' });
    aoVoltar();
  }

  function adicionarOutro() {
    setEtapa({ tipo: 'buscar' });
    setTermo('');
    setResultados(null);
    requestAnimationFrame(() => campo.current?.focus());
  }

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <button type="button" className={styles.voltar} onClick={voltarUmPasso} aria-label="Voltar">
          <IconeVoltar />
        </button>
        <h1 className={styles.titulo}>Adicionar filme</h1>
      </header>

      {etapa.tipo === 'buscar' ? (
        <main className={styles.conteudo}>
          <label className={styles.busca}>
            <IconeBusca tamanho={20} />
            <input
              ref={campo}
              className={styles.campo}
              type="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome do filme"
              aria-label="Buscar filme no TMDB"
              autoFocus
              enterKeyHint="search"
            />
          </label>

          {buscando && !resultados ? <p className={styles.aviso}>Buscando…</p> : null}
          {erroDaBusca ? (
            <p className={styles.aviso} role="alert">
              {erroDaBusca}
            </p>
          ) : null}
          {resultados && resultados.length === 0 ? (
            <p className={styles.aviso}>
              O TMDB não achou nada com “{termo.trim()}”. Tente o título original, ou menos palavras.
            </p>
          ) : null}

          {resultados && resultados.length > 0 ? (
            <ul className={styles.resultados} aria-busy={buscando}>
              {resultados.map((r) => (
                <li key={r.tmdbId}>
                  <button
                    type="button"
                    className={styles.resultado}
                    onClick={() => setEtapa({ tipo: 'opcoes', filme: r })}
                  >
                    <Poster url={r.posterUrl} />
                    <span className={styles.texto}>
                      <span className={styles.nome}>{r.titulo}</span>
                      <span className={styles.meta}>{linhaDoFilme(r)}</span>
                      {r.tituloOriginal ? (
                        <span className={styles.original}>{r.tituloOriginal}</span>
                      ) : null}
                    </span>
                    {r.titleId ? <span className={styles.selo}>No catálogo</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* §3.5: discreto, e só depois de uma busca */}
          {resultados ? (
            <button type="button" className={styles.naoEncontrei} onClick={() => setEtapa({ tipo: 'manual' })}>
              Não encontrei o filme
            </button>
          ) : null}

          <p className={styles.atribuicao}>Busca e dados de filmes: TMDB</p>
        </main>
      ) : etapa.tipo === 'manual' ? (
        <main className={styles.conteudo}>
          <FormularioManual
            tituloInicial={termo.trim()}
            aoContinuar={(titulo, ano) =>
              setEtapa({
                tipo: 'opcoes',
                filme: { manual: true, tmdbId: 0, titulo, ano, tituloOriginal: null, posterUrl: null, diretores: [], titleId: null },
              })
            }
          />
        </main>
      ) : (
        <main className={styles.conteudo}>
          <div className={styles.escolhido}>
            <Poster url={etapa.filme.posterUrl} grande />
            <div className={styles.texto}>
              <p className={styles.nomeGrande}>{etapa.filme.titulo}</p>
              <p className={styles.meta}>{linhaDoFilme(etapa.filme)}</p>
            </div>
          </div>

          {etapa.tipo === 'opcoes' ? (
            <div className={styles.opcoes}>
              <button
                type="button"
                className={styles.primario}
                disabled={enviando}
                onClick={() => setEtapa({ tipo: 'assistimos', filme: etapa.filme })}
              >
                Já assistimos
              </button>
              <button
                type="button"
                className={styles.secundario}
                disabled={enviando}
                onClick={() => querAssistir(etapa.filme, false)}
              >
                Quero assistir
              </button>
              <button
                type="button"
                className={styles.secundario}
                disabled={enviando}
                onClick={() => querAssistir(etapa.filme, true)}
              >
                {nomeDoOutro ? `Eu e ${nomeDoOutro} queremos` : 'Nós dois queremos'}
              </button>
              <button
                type="button"
                className={styles.discreto}
                disabled={enviando}
                onClick={() => abrirDetalhe(etapa.filme)}
              >
                {etapa.filme.titleId ? 'Abrir o filme' : 'Só abrir o filme'}
              </button>
              {etapa.filme.manual ? (
                <p className={styles.aviso}>
                  Sem o TMDB, o filme entra só com o título e vai para a fila Revisar. Quando ele aparecer no
                  TMDB, é lá que vocês ligam os dois, e o que registrarem agora vai junto.
                </p>
              ) : null}
              {erro ? (
                <p className={styles.aviso} role="alert">
                  {erro}
                </p>
              ) : null}
            </div>
          ) : null}

          {etapa.tipo === 'assistimos' ? (
            <FormularioDeVisualizacao
              eu={eu}
              enviando={enviando}
              erro={erro}
              aoEnviar={(dados) => registrar(etapa.filme, dados)}
              aoCancelar={() => setEtapa({ tipo: 'opcoes', filme: etapa.filme })}
            />
          ) : null}

          {etapa.tipo === 'feito' ? (
            <div className={styles.opcoes}>
              <p className={styles.feito} role="status">
                {etapa.mensagem}
              </p>

              {/* §3.3: registrar tira o filme da lista de quem estava, com desfazer */}
              {etapa.removidos.length > 0 ? (
                <div className={styles.removido} role="status">
                  <span>{desfeito ? 'Voltou para a lista.' : 'Removido da lista de quem assistiu.'}</span>
                  {!desfeito ? (
                    <button
                      type="button"
                      className={styles.desfazer}
                      disabled={enviando}
                      onClick={() => desfazerRemocaoDaLista(etapa.removidos)}
                    >
                      Desfazer
                    </button>
                  ) : null}
                </div>
              ) : null}

              {erro ? (
                <p className={styles.aviso} role="alert">
                  {erro}
                </p>
              ) : null}

              <button type="button" className={styles.primario} onClick={() => aoAbrir(etapa.titleId)}>
                Abrir o filme
              </button>
              <button type="button" className={styles.secundario} onClick={adicionarOutro}>
                Adicionar outro
              </button>
            </div>
          ) : null}
        </main>
      )}
    </div>
  );
}

function Poster({ url, grande = false }: { url: string | null; grande?: boolean }) {
  const classe = grande ? `${styles.poster} ${styles.posterGrande}` : styles.poster;
  return url ? (
    <img className={classe} src={url} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className={`${classe} ${styles.semPoster}`} aria-hidden="true" />
  );
}

/** O título (e o ano, se souber) do filme que o TMDB ainda não tem. */
function FormularioManual({
  tituloInicial,
  aoContinuar,
}: {
  tituloInicial: string;
  aoContinuar: (titulo: string, ano: number | null) => void;
}) {
  const [titulo, setTitulo] = useState(tituloInicial);
  const [ano, setAno] = useState('');
  const anoNumero = ano.trim() === '' ? null : Number(ano);
  const anoValido = anoNumero === null || (Number.isInteger(anoNumero) && anoNumero >= 1888 && anoNumero <= 2100);
  const pronto = titulo.trim().length > 0 && anoValido;

  return (
    <form
      className={styles.opcoes}
      onSubmit={(e) => {
        e.preventDefault();
        if (pronto) aoContinuar(titulo.trim().replace(/\s+/g, ' '), anoNumero);
      }}
    >
      <p className={styles.aviso}>
        Para o filme que ainda não está no TMDB, como um anúncio muito recente. Ele entra no acervo só com o
        título, sem pôster nem sinopse.
      </p>
      <label className={styles.rotuloDoCampo}>
        Título
        <input
          className={styles.campoManual}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={200}
          autoFocus
          required
        />
      </label>
      <label className={styles.rotuloDoCampo}>
        Ano (se souber)
        <input
          className={styles.campoManual}
          value={ano}
          onChange={(e) => setAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="2027"
          aria-invalid={!anoValido}
        />
      </label>
      <button type="submit" className={styles.primario} disabled={!pronto}>
        Continuar
      </button>
    </form>
  );
}

/** "2025 · Dir. Zach Cregger" — sem ano ou sem diretor, a parte some. */
function linhaDoFilme(f: Filme): string {
  if (f.manual) return [f.ano ? String(f.ano) : 'Sem data', 'Fora do TMDB'].join(' · ');
  return [f.ano ? String(f.ano) : 'Sem data', f.diretores.length ? `Dir. ${f.diretores.join(', ')}` : null]
    .filter(Boolean)
    .join(' · ');
}
