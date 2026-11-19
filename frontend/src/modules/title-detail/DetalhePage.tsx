import { useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { IconeIngresso, IconeMais, IconeVoltar } from '../../shared/components/Icones';
import { RatingBadges } from '../../shared/components/RatingBadges';
import { SeloDePessoa } from '../../shared/components/SeloDePessoa';
import { useApi } from '../../shared/hooks/useApi';
import { formatarNota } from '../../shared/notas';
import { PERFIL_DA_PESSOA, perfilDaPessoa } from '../../shared/pessoas';
import type {
  DadosDaVisualizacao,
  DetalheDoAcervo,
  PerfilDoApp,
  Pessoa,
  RespostaDaVisualizacao,
  VisualizacaoDoTitulo,
} from '../../shared/api/tipos';
import { FormularioDeVisualizacao } from '../acervo/FormularioDeVisualizacao';
import { TagsManuais } from '../tags/TagsManuais';
import { Comentarios } from './Comentarios';
import { SessoesDoFilme } from './SessoesDoFilme';
import styles from './DetalhePage.module.scss';

/**
 * Detalhe do filme (cineon-expansao §7) — o mesmo para filme de cinema e do
 * acervo. Substitui o detalhe antigo (`FilmePage`) em `/filme/:id`.
 *
 * A ordem das seções é a do print do Crônicas de Gatur
 * (`cineon-expansao/design/detalhe-referencia-cg.png`), com os tokens do
 * Cineon. No desktop, a mesma coluna, mais larga (decisão de 18/11/2026).
 *
 * Tudo o que diz respeito ao casal — assistido, quero assistir, interesse,
 * notas — vem calculado do backend (`GET /library/titles/:id`); depois de cada
 * ação a tela pede o detalhe de novo, em vez de adivinhar o estado.
 */

const MOTIVO: Record<string, string> = {
  low_confidence: 'o candidato encontrado não teve nota suficiente',
  no_candidate: 'nenhum candidato foi encontrado no TMDB',
  possible_duplicate: 'pode ser o mesmo filme de outro título já no catálogo',
  probable_non_film: 'pode não ser um filme (show, ópera, transmissão)',
  import_low_confidence: 'veio do Crônicas de Gatur sem certeza de qual filme do TMDB é',
};

const STATUS_DE_PRODUCAO: Record<string, string> = {
  Rumored: 'Boato',
  Planned: 'Planejado',
  'In Production': 'Em produção',
  'Post Production': 'Em pós-produção',
  Canceled: 'Cancelado',
};

/** 0, 0,5, 1 … 10 */
const NOTAS = Array.from({ length: 21 }, (_, i) => i / 2);

export function DetalhePage({
  id,
  perfil,
  aoVoltar,
  aoNavegar,
}: {
  id: string;
  perfil: PerfilDoApp;
  aoVoltar: () => void;
  aoNavegar: (para: string) => void;
}) {
  const filme = useApi<DetalheDoAcervo>(`/library/titles/${id}`);
  const perfis = useApi<{ itens: PerfilDoApp[] }>('/users');

  if (filme.carregando && !filme.dados) {
    return <p className={styles.aviso}>Carregando…</p>;
  }

  if (!filme.dados) {
    return (
      <div className={styles.tela}>
        <Cabecalho aoVoltar={aoVoltar} aoAdicionar={() => aoNavegar('/adicionar')} />
        <div className={styles.aviso} role="alert">
          <p>{filme.erro ?? 'Não consegui carregar este filme.'}</p>
          <button type="button" className={styles.tentar} onClick={filme.recarregar}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  return (
    <Conteudo
      dados={filme.dados}
      perfil={perfil}
      perfis={perfis.dados?.itens ?? []}
      recarregar={filme.recarregar}
      aoVoltar={aoVoltar}
      aoNavegar={aoNavegar}
    />
  );
}

function Conteudo({
  dados,
  perfil,
  perfis,
  recarregar,
  aoVoltar,
  aoNavegar,
}: {
  dados: DetalheDoAcervo;
  perfil: PerfilDoApp;
  perfis: PerfilDoApp[];
  recarregar: () => void;
  aoVoltar: () => void;
  aoNavegar: (para: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [justwatch, setJustwatch] = useState(dados.justwatchUrl ?? '');
  /** linhas que saíram da lista ao registrar — o "Desfazer" do §3.3 */
  const [saiuDaLista, setSaiuDaLista] = useState<string[] | null>(null);
  /** carimbo do "Remover do catálogo" — o desfazer vale até recarregar (§4.4) */
  const [removidoEm, setRemovidoEm] = useState<string | null>(null);

  const eu = dados.eu;
  const minha = dados.pessoas.find((p) => p.pessoa === eu);
  const noAcervo = dados.pessoas.some(
    (p) => p.assistiu || p.querAssistir || p.nota !== null || p.comentario !== null,
  );
  const tagsManuais = dados.tags.filter((t) => t.facet === 'manual');
  const corDe = (pessoa: Pessoa) => perfilDaPessoa(perfis, pessoa);

  async function agir(acao: () => Promise<void>) {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
      recarregar();
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.');
    } finally {
      setEnviando(false);
    }
  }

  const definirInteresse = (estrelas: number) =>
    agir(async () => {
      // tocar na estrela que já está marcada apaga as estrelas, mas mantém na lista
      const interesse = minha?.interesse === estrelas ? null : estrelas;
      await api.put(`/titles/${dados.id}/watchlist`, { interesse });
    });

  const tirarDaLista = () => agir(async () => void (await api.delete(`/titles/${dados.id}/watchlist`)));

  const definirNota = (valor: string) =>
    agir(async () => {
      if (valor === '') await api.delete(`/titles/${dados.id}/rating`);
      else await api.put(`/titles/${dados.id}/rating`, { nota: Number(valor) });
    });

  const registrar = (corpo: DadosDaVisualizacao) =>
    agir(async () => {
      const r = await api.post<RespostaDaVisualizacao>(`/titles/${dados.id}/watches`, corpo);
      setRegistrando(false);
      setSaiuDaLista(r.removidosDaLista.length > 0 ? r.removidosDaLista.map((x) => x.id) : null);
    });

  const desfazerSaidaDaLista = (ids: string[]) =>
    agir(async () => {
      await api.post('/watchlist/restaurar', { ids });
      setSaiuDaLista(null);
    });

  const removerVisualizacao = (v: VisualizacaoDoTitulo) => {
    if (!window.confirm(`Remover a visualização de ${formatarDataDaVisualizacao(v)}?`)) return;
    void agir(async () => void (await api.delete(`/watches/${v.id}`)));
  };

  const salvarJustwatch = () =>
    agir(async () => {
      await api.patch(`/library/titles/${dados.id}`, { justwatchUrl: justwatch.trim() || null });
      setEditando(false);
    });

  const removerDoCatalogo = () => {
    if (!window.confirm(`Remover "${dados.titulo}" do catálogo de vocês? Visualizações, lista e notas saem juntas.`)) {
      return;
    }
    void agir(async () => {
      const r = await api.delete<{ removidoEm: string }>(`/library/titles/${dados.id}`);
      setRemovidoEm(r.removidoEm);
      // a remoção leva a lista junto: o "desfazer" anterior, da saída da lista,
      // não faz mais sentido, e dois "Desfazer" na tela seria pedir confusão
      setSaiuDaLista(null);
      setRegistrando(false);
    });
  };

  const desfazerRemocao = (carimbo: string) =>
    agir(async () => {
      await api.post(`/library/titles/${dados.id}/restaurar`, { removidoEm: carimbo });
      setRemovidoEm(null);
    });

  return (
    <div className={styles.tela}>
      <div
        className={styles.ambiente}
        style={dados.backdropUrl ? { backgroundImage: `url(${dados.backdropUrl})` } : undefined}
        aria-hidden="true"
      />

      <Cabecalho aoVoltar={aoVoltar} aoAdicionar={() => aoNavegar('/adicionar')} />

      {/* 1–3: pôster, estado, título e direção */}
      <header className={styles.capa}>
        <div className={styles.poster}>
          {dados.posterUrl ? (
            <img className={styles.imagem} src={dados.posterUrl} alt="" decoding="async" />
          ) : (
            <span className={styles.semPoster}>sem pôster</span>
          )}
        </div>

        <div className={styles.identidade}>
          <ul className={styles.chips} aria-label="Estado">
            <li className={`${styles.chip} ${styles.chipTipo}`}>Filmes</li>
            {minha?.assistiu ? (
              <li className={`${styles.chip} ${styles.chipEstado}`}>Assistido</li>
            ) : minha?.querAssistir ? (
              <li className={`${styles.chip} ${styles.chipEstado}`}>Quero assistir</li>
            ) : null}
            {tagsManuais.map((t) => (
              <li key={t.id} className={styles.chip}>
                {t.label}
              </li>
            ))}
          </ul>

          <h1 className={styles.titulo}>{dados.titulo}</h1>

          {dados.tituloOriginal && dados.tituloOriginal !== dados.titulo ? (
            <p className={styles.original}>{dados.tituloOriginal}</p>
          ) : null}

          {dados.diretores.length > 0 ? (
            <p className={styles.direcao}>Dir. {dados.diretores.map((d) => d.nome).join(', ')}</p>
          ) : null}
        </div>
      </header>

      {/* §2: o órfão aparece, e diz por que está sem metadata */}
      {dados.orfao ? (
        <p className={styles.faixa} role="status">
          Metadata pendente
          {dados.pendencia ? ` — ${MOTIVO[dados.pendencia.motivo] ?? 'está na fila de revisão'}` : null}.
        </p>
      ) : null}

      {removidoEm ? (
        <div className={styles.faixa} role="status">
          <span>Removido do catálogo de vocês.</span>
          <button
            type="button"
            className={styles.desfazer}
            disabled={enviando}
            onClick={() => void desfazerRemocao(removidoEm)}
          >
            Desfazer
          </button>
        </div>
      ) : null}

      <main className={styles.corpo}>
        {/* 4. estúdios */}
        {dados.estudios.length > 0 ? (
          <Secao rotulo="Estúdios">
            <ul className={styles.chips}>
              {dados.estudios.map((e) => (
                <li key={e} className={styles.chip}>
                  {e}
                </li>
              ))}
            </ul>
          </Secao>
        ) : null}

        {/* 5. sinopse, com o selo de idioma do §5.2 — nunca vazia sem explicação */}
        <Secao rotulo="Sinopse">
          {dados.sinopse ? (
            <>
              {dados.sinopseIdioma && dados.sinopseIdioma !== 'pt-BR' ? (
                <span className={styles.seloIdioma}>sinopse em inglês</span>
              ) : null}
              <p className={styles.sinopse}>{dados.sinopse}</p>
            </>
          ) : (
            <p className={styles.vazio}>
              {dados.statusProducao && dados.statusProducao !== 'Released'
                ? 'O filme ainda não foi lançado e a sinopse não foi divulgada.'
                : 'O TMDB não tem sinopse deste filme, nem em português nem em inglês.'}
            </p>
          )}
        </Secao>

        {/* 6. elenco principal */}
        {dados.elenco.length > 0 ? (
          <Secao rotulo="Elenco principal">
            <ul className={styles.elenco}>
              {dados.elenco.map((p) => (
                <li key={`${p.nome}-${p.personagem ?? ''}`} className={styles.pessoa}>
                  {p.fotoUrl ? (
                    <img className={styles.foto} src={p.fotoUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className={`${styles.foto} ${styles.iniciais}`} aria-hidden="true">
                      {iniciais(p.nome)}
                    </span>
                  )}
                  <span className={styles.nomeDaPessoa}>{p.nome}</span>
                  {p.personagem ? <span className={styles.personagem}>{p.personagem}</span> : null}
                </li>
              ))}
            </ul>
          </Secao>
        ) : null}

        {/* 7. gêneros */}
        {dados.generos.length > 0 ? (
          <Secao rotulo="Gêneros">
            <ul className={styles.chips}>
              {dados.generos.map((g) => (
                <li key={g} className={styles.chip}>
                  {g}
                </li>
              ))}
            </ul>
          </Secao>
        ) : null}

        {/* 8–9. estreia e notas da crítica */}
        <div className={styles.linhaDeFatos}>
          {dados.estreia ? (
            <p className={styles.estreia}>
              Estreia{dados.estreia.mundial ? ' (mundial)' : ''}: {formatarDia(dados.estreia.data)}
            </p>
          ) : (
            <p className={styles.estreia}>Sem data de estreia</p>
          )}
          {dados.statusProducao && STATUS_DE_PRODUCAO[dados.statusProducao] ? (
            <p className={styles.estreia}>{STATUS_DE_PRODUCAO[dados.statusProducao]}</p>
          ) : null}
          <RatingBadges imdb={dados.notas.imdb} rt={dados.notas.rt} />
        </div>

        {/* 10. o bloco da pessoa: interesse antes de ver, notas depois */}
        <Secao rotulo={minha?.assistiu ? 'Notas de vocês' : 'Marque seu interesse'}>
          {!minha?.assistiu ? (
            <div className={styles.interesse}>
              <div className={styles.estrelas} role="group" aria-label="Interesse, de 1 a 5 estrelas">
                {[1, 2, 3, 4, 5].map((n) => {
                  const acesa = (minha?.interesse ?? 0) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      className={acesa ? `${styles.estrela} ${styles.estrelaAcesa}` : styles.estrela}
                      aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
                      aria-pressed={minha?.interesse === n}
                      disabled={enviando}
                      onClick={() => void definirInteresse(n)}
                    >
                      {acesa ? '★' : '☆'}
                    </button>
                  );
                })}
              </div>
              {minha?.querAssistir ? (
                <button type="button" className={styles.link} disabled={enviando} onClick={() => void tirarDaLista()}>
                  Na sua lista · tirar
                </button>
              ) : (
                <span className={styles.dica}>Marcar estrelas põe o filme na sua lista</span>
              )}
            </div>
          ) : null}

          <ul className={styles.notas}>
            {dados.pessoas.map((p) => {
              const cor = corDe(p.pessoa);
              const souEu = p.pessoa === eu;
              return (
                <li key={p.pessoa} className={styles.notaDaPessoa}>
                  <SeloDePessoa
                    perfilId={PERFIL_DA_PESSOA[p.pessoa]}
                    acento={cor?.acento ?? '#A79FB5'}
                    tamanho={28}
                    rotulo={cor?.nome}
                  />
                  {souEu && p.podeDarNota ? (
                    <select
                      className={styles.seletorDeNota}
                      value={p.nota === null ? '' : String(p.nota)}
                      onChange={(e) => void definirNota(e.target.value)}
                      disabled={enviando}
                      aria-label="Sua nota, de 0 a 10"
                    >
                      <option value="">Sem nota</option>
                      {NOTAS.map((n) => (
                        <option key={n} value={String(n)}>
                          {formatarNota(n)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={styles.valorDaNota}>
                      {p.nota !== null
                        ? formatarNota(p.nota)
                        : p.assistiu
                          ? 'sem nota'
                          : p.querAssistir
                            ? `quer ver${p.interesse ? ` · ${'★'.repeat(p.interesse)}` : ''}`
                            : 'não viu'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Secao>

        {/* os comentários de cada um (19/11/2026): o meu sempre, para poder escrever */}
        <Secao rotulo="Comentários">
          <Comentarios titleId={dados.id} eu={eu} pessoas={dados.pessoas} corDe={corDe} aoMudar={recarregar} />
        </Secao>

        {/* 11. assistimos */}
        <Secao rotulo="Assistimos">
          {saiuDaLista ? (
            <div className={styles.faixaInterna} role="status">
              <span>Removido da lista de quem assistiu.</span>
              <button
                type="button"
                className={styles.desfazer}
                disabled={enviando}
                onClick={() => void desfazerSaidaDaLista(saiuDaLista)}
              >
                Desfazer
              </button>
            </div>
          ) : null}

          {dados.visualizacoes.length > 0 ? (
            <ul className={styles.visualizacoes}>
              {dados.visualizacoes.map((v) => (
                <li key={v.id} className={styles.visualizacao}>
                  <span className={styles.quando}>{formatarDataDaVisualizacao(v)}</span>
                  <span className={styles.onde}>
                    {v.local === 'CASA'
                      ? '🏠 Em casa'
                      : `🎬 ${[v.cinema ?? 'Cinema', v.tipoSala].filter(Boolean).join(' · ')}`}
                  </span>
                  <span className={styles.quem}>
                    {v.participantes.map((pessoa) => (
                      <SeloDePessoa
                        key={pessoa}
                        perfilId={PERFIL_DA_PESSOA[pessoa]}
                        acento={corDe(pessoa)?.acento ?? '#A79FB5'}
                        tamanho={22}
                        rotulo={corDe(pessoa)?.nome}
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    className={styles.remover}
                    aria-label="Remover esta visualização"
                    disabled={enviando}
                    onClick={() => removerVisualizacao(v)}
                  >
                    ×
                  </button>
                  {v.observacao ? <span className={styles.observacao}>{v.observacao}</span> : null}
                </li>
              ))}
            </ul>
          ) : !registrando ? (
            <p className={styles.vazio}>Nenhuma visualização registrada.</p>
          ) : null}

          {registrando ? (
            <FormularioDeVisualizacao
              eu={eu}
              // §4.2: no detalhe de um filme em cartaz, o formulário já vem no
              // cinema e com a data de hoje
              inicial={dados.emCartaz ? { local: 'CINEMA' } : undefined}
              enviando={enviando}
              erro={erro}
              aoEnviar={(corpo) => void registrar(corpo)}
              aoCancelar={() => setRegistrando(false)}
            />
          ) : (
            <button
              type="button"
              className={styles.primario}
              onClick={() => {
                setErro(null);
                setRegistrando(true);
              }}
            >
              Registrar que assistimos
            </button>
          )}
        </Secao>

        {/* 12. se estiver em cartaz: as sessões e o ingresso.com */}
        {dados.emCartaz ? (
          <>
            {dados.ingressoUrl ? (
              <a className={styles.ingresso} href={dados.ingressoUrl} target="_blank" rel="noreferrer noopener">
                <IconeIngresso tamanho={19} />
                Ver no ingresso.com
              </a>
            ) : null}
            <SessoesDoFilme sessoes={dados.sessoes} />
          </>
        ) : null}

        {/* §6: onde está disponível no Brasil. Dado do JustWatch — a atribuição é
            obrigatória (§5.4), sob pena de o TMDB revogar o acesso à API */}
        {dados.provedores.length > 0 ? (
          <Secao rotulo="Onde assistir">
            {dados.provedores.map((grupo) => (
              <div key={grupo.tipo} className={styles.provedores}>
                <span className={styles.tipoDeProvedor}>{grupo.rotulo}</span>
                <ul className={styles.logos}>
                  {grupo.itens.map((p) => (
                    <li key={p.id} title={p.nome}>
                      {p.logoUrl ? (
                        <img className={styles.logo} src={p.logoUrl} alt={p.nome} loading="lazy" decoding="async" />
                      ) : (
                        <span className={`${styles.logo} ${styles.logoTexto}`}>{p.nome}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className={styles.atribuicao}>Dados de streaming: JustWatch</p>
          </Secao>
        ) : null}

        {/* 13. ações */}
        {erro && !registrando ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        <div className={styles.acoes}>
          <button
            type="button"
            className={styles.contorno}
            aria-expanded={editando}
            onClick={() => setEditando((e) => !e)}
          >
            Editar
          </button>
          <a
            className={`${styles.contorno} ${styles.contornoAcento}`}
            href={dados.ondeAssistirUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Onde assistir
          </a>
        </div>

        {editando ? (
          <div className={styles.edicao}>
            <label className={styles.campoRotulado}>
              <span className={styles.rotuloDoCampo}>Link do JustWatch</span>
              <input
                className={styles.campo}
                value={justwatch}
                onChange={(e) => setJustwatch(e.target.value)}
                placeholder="https://br.justwatch.com/br/filme/…"
                inputMode="url"
              />
              <span className={styles.dica}>
                Cole o endereço da página do filme no JustWatch: daí em diante, "Onde assistir" vai direto
                para ela.
              </span>
            </label>
            <button type="button" className={styles.contorno} disabled={enviando} onClick={() => void salvarJustwatch()}>
              Salvar link
            </button>

            <TagsManuais titleId={dados.id} perfil={perfil} iniciais={dados.tags} />
          </div>
        ) : null}

        {noAcervo ? (
          <button type="button" className={styles.perigo} disabled={enviando} onClick={removerDoCatalogo}>
            Remover do catálogo
          </button>
        ) : null}

        <p className={styles.atribuicao}>Dados de filmes: TMDB</p>
      </main>
    </div>
  );
}

function Cabecalho({ aoVoltar, aoAdicionar }: { aoVoltar: () => void; aoAdicionar: () => void }) {
  return (
    <div className={styles.cabecalho}>
      <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
        <IconeVoltar />
      </button>
      <button type="button" className={styles.voltar} onClick={aoAdicionar} aria-label="Adicionar filme">
        <IconeMais />
      </button>
    </div>
  );
}

function Secao({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.rotulo}>{rotulo}</h2>
      {children}
    </section>
  );
}

/** "Julia Garner" → "JG" — o lugar da foto quando o TMDB não tem uma. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** `2026-11-26` → `26/11/2026` (§7). */
function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** A data como foi dita: dia, "jul 2019" ou só "2019". */
function formatarDataDaVisualizacao(v: VisualizacaoDoTitulo): string {
  if (v.precisao === 'ANO') return v.data;
  if (v.precisao === 'MES') return `${MESES[Number(v.data.slice(5, 7)) - 1]} ${v.data.slice(0, 4)}`;
  return formatarDia(v.data);
}

/** 8.5 → "8,5" */
