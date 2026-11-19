import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { BottomNav } from '../../shared/components/BottomNav';
import { CabecalhoDaAba } from '../../shared/components/CabecalhoDaAba';
import { IconeBusca } from '../../shared/components/Icones';
import { PosterCard } from '../../shared/components/PosterCard';
import { useApi } from '../../shared/hooks/useApi';
import { PESSOA_DO_PERFIL, outraPessoa, perfilDaPessoa } from '../../shared/pessoas';
import type { Assistidos, CardDoAssistido, PerfilDoApp } from '../../shared/api/tipos';
import { OpinioesDoCard } from './OpinioesDoCard';
import styles from './AssistidosPage.module.scss';

/**
 * A aba "Assistidos" (cineon-expansao §8): todo filme que vocês viram, do mais
 * recente para o mais antigo, um card por filme.
 *
 * O card é o `PosterCard` de sempre (§8: "todos os cards continuam
 * idênticos"); a faixa do rodapé é a data em que assistiram e os rostos no
 * canto são quem assistiu.
 *
 * Filtros do §8: quem, casa/cinema, ano em que assistiram, gênero, diretor,
 * nota e busca por título. Os de uso diário ficam à vista; ano, gênero, nota e
 * diretor, num "Mais filtros" para não empurrar a grade para baixo.
 */

type Quem = '' | 'CAT' | 'BEAR' | 'AMBOS';

const ESPERA_DA_DIGITACAO_MS = 300;

export function AssistidosPage({
  perfil,
  aoNavegar,
}: {
  perfil: PerfilDoApp;
  aoNavegar: (para: string) => void;
}) {
  const eu = PESSOA_DO_PERFIL[perfil.id] ?? 'CAT';
  const perfis = useApi<{ itens: PerfilDoApp[] }>('/users');
  const outro = perfis.dados ? perfilDaPessoa(perfis.dados.itens, outraPessoa(eu)) : undefined;

  const [termo, setTermo] = useState('');
  const [q, setQ] = useState('');
  const [quem, setQuem] = useState<Quem>('');
  const [local, setLocal] = useState<'' | 'CASA' | 'CINEMA'>('');
  const [ano, setAno] = useState('');
  const [genero, setGenero] = useState('');
  const [notaMin, setNotaMin] = useState('');
  const [diretor, setDiretor] = useState('');
  const [maisFiltros, setMaisFiltros] = useState(false);

  const [itens, setItens] = useState<CardDoAssistido[]>([]);
  const [resposta, setResposta] = useState<Assistidos | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  // a busca por título e por diretor espera a digitação parar
  useEffect(() => {
    const espera = window.setTimeout(() => setQ(termo.trim()), ESPERA_DA_DIGITACAO_MS);
    return () => window.clearTimeout(espera);
  }, [termo]);

  const [diretorFiltrado, setDiretorFiltrado] = useState('');
  useEffect(() => {
    const espera = window.setTimeout(() => setDiretorFiltrado(diretor.trim()), ESPERA_DA_DIGITACAO_MS);
    return () => window.clearTimeout(espera);
  }, [diretor]);

  const filtros = useMemo(
    () => ({
      ...(q ? { q } : {}),
      ...(quem ? { pessoa: quem } : {}),
      ...(local ? { local } : {}),
      ...(ano ? { ano } : {}),
      ...(genero ? { genero } : {}),
      ...(notaMin ? { notaMin } : {}),
      ...(diretorFiltrado ? { diretor: diretorFiltrado } : {}),
    }),
    [q, quem, local, ano, genero, notaMin, diretorFiltrado],
  );
  const chave = JSON.stringify(filtros);

  // filtro novo recomeça da primeira página
  useEffect(() => setPagina(1), [chave]);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    api
      .get<Assistidos>('/assistidos', { query: { ...filtros, pagina }, signal: controller.signal })
      .then((r) => {
        setResposta(r);
        setItens((atuais) => (pagina === 1 ? r.itens : [...atuais, ...r.itens]));
        setErro(null);
      })
      .catch((problema: unknown) => {
        if (controller.signal.aborted) return;
        setErro(problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
    // `filtros` muda junto com `chave`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, pagina, gatilho]);

  const filtrosAtivos = Object.keys(filtros).length;
  const extrasAtivos = [ano, genero, notaMin, diretor].filter(Boolean).length;

  function limpar() {
    setTermo('');
    setQuem('');
    setLocal('');
    setAno('');
    setGenero('');
    setNotaMin('');
    setDiretor('');
  }

  const opcoesDeQuem: Array<{ id: Quem; rotulo: string }> = [
    { id: '', rotulo: 'Todos' },
    { id: eu, rotulo: 'Eu' },
    { id: outraPessoa(eu), rotulo: outro?.nome ?? 'O outro' },
    { id: 'AMBOS', rotulo: 'Juntos' },
  ];

  const total = resposta?.total ?? 0;

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <CabecalhoDaAba
        titulo="Assistidos"
        subtitulo={resposta ? (total === 1 ? '1 filme' : `${total} filmes`) : null}
        aoAdicionar={() => aoNavegar('/adicionar')}
      />

      <div className={styles.filtros}>
        <label className={styles.busca}>
          <IconeBusca tamanho={18} />
          <input
            className={styles.campoDeBusca}
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar pelo título"
            aria-label="Buscar nos assistidos pelo título"
          />
        </label>

        <div className={styles.pills} role="group" aria-label="Quem assistiu">
          {opcoesDeQuem.map((o) => (
            <button
              key={o.id || 'todos'}
              type="button"
              className={quem === o.id ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
              aria-pressed={quem === o.id}
              onClick={() => setQuem(o.id)}
            >
              {o.rotulo}
            </button>
          ))}
          <span className={styles.divisor} aria-hidden="true" />
          {(
            [
              ['CASA', '🏠 Casa'],
              ['CINEMA', '🎬 Cinema'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={local === valor ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
              aria-pressed={local === valor}
              onClick={() => setLocal((atual) => (atual === valor ? '' : valor))}
            >
              {rotulo}
            </button>
          ))}
          <button
            type="button"
            className={extrasAtivos ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
            aria-expanded={maisFiltros}
            onClick={() => setMaisFiltros((m) => !m)}
          >
            {extrasAtivos ? `Mais filtros · ${extrasAtivos}` : 'Mais filtros'}
          </button>
        </div>

        {maisFiltros ? (
          <div className={styles.extras}>
            <select className={styles.campo} value={ano} onChange={(e) => setAno(e.target.value)} aria-label="Ano em que assistiram">
              <option value="">Qualquer ano</option>
              {resposta?.facetas.anos.map((a) => (
                <option key={a} value={a}>
                  Vimos em {a}
                </option>
              ))}
            </select>
            <select className={styles.campo} value={genero} onChange={(e) => setGenero(e.target.value)} aria-label="Gênero">
              <option value="">Qualquer gênero</option>
              {resposta?.facetas.generos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select className={styles.campo} value={notaMin} onChange={(e) => setNotaMin(e.target.value)} aria-label="Nota mínima">
              <option value="">Qualquer nota</option>
              {[9, 8, 7, 6, 5].map((n) => (
                <option key={n} value={n}>
                  Nota {n} ou mais (de algum de vocês)
                </option>
              ))}
            </select>
            <input
              className={styles.campo}
              value={diretor}
              onChange={(e) => setDiretor(e.target.value)}
              placeholder="Diretor"
              aria-label="Diretor"
            />
          </div>
        ) : null}
      </div>

      <main className={styles.conteudo} aria-busy={carregando}>
        {erro ? (
          <div className={styles.aviso} role="alert">
            <p>{erro}</p>
            <button type="button" className={styles.tentar} onClick={() => setGatilho((n) => n + 1)}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        {!carregando && !erro && itens.length === 0 ? (
          filtrosAtivos > 0 ? (
            <div className={styles.aviso}>
              <p>Nenhum filme com esses filtros.</p>
              <button type="button" className={styles.tentar} onClick={limpar}>
                Limpar os filtros
              </button>
            </div>
          ) : (
            <div className={styles.aviso}>
              <p>Nenhum filme registrado ainda. Tudo o que vocês assistirem, no cinema ou em casa, aparece aqui.</p>
              <button type="button" className={styles.tentar} onClick={() => aoNavegar('/adicionar')}>
                Adicionar filme
              </button>
            </div>
          )
        ) : null}

        {itens.length > 0 ? (
          <div className={styles.grade} data-carregando={carregando && pagina === 1 ? '' : undefined}>
            {itens.map((item) => (
              <PosterCard
                key={item.id}
                titulo={item}
                aoAbrir={(id) => aoNavegar(`/filme/${id}`)}
                rodape={<OpinioesDoCard opinioes={item.opinioes} perfis={perfis.dados?.itens ?? []} />}
              />
            ))}
          </div>
        ) : null}

        {resposta?.proximaPagina ? (
          <button
            type="button"
            className={styles.maisFilmes}
            disabled={carregando}
            onClick={() => setPagina(resposta.proximaPagina!)}
          >
            {carregando ? 'Carregando…' : `Mostrar mais (${total - itens.length})`}
          </button>
        ) : null}
      </main>

      <BottomNav
        ativa="assistidos"
        aoNavegar={aoNavegar}
        aoTocarNaAtiva={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </div>
  );
}
