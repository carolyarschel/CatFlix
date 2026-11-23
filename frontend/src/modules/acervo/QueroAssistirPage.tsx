import { useMemo, useState } from 'react';
import { BottomNav } from '../../shared/components/BottomNav';
import { CabecalhoDaAba } from '../../shared/components/CabecalhoDaAba';
import { PosterCard } from '../../shared/components/PosterCard';
import { useApi } from '../../shared/hooks/useApi';
import { PERFIL_DA_PESSOA, PESSOA_DO_PERFIL, outraPessoa, perfilDaPessoa } from '../../shared/pessoas';
import type {
  CardDeTitulo,
  ItemDaLista,
  ListaQueroAssistir,
  MarcaDeUsuario,
  PerfilDoApp,
  Pessoa,
} from '../../shared/api/tipos';
import styles from './QueroAssistirPage.module.scss';

/**
 * A aba "Quero assistir" (cineon-expansao §8), com o filtro minha / dele / dos
 * dois.
 *
 * Desde 23/11/2026 é uma grade só, como a dos Assistidos: sem a separação em
 * "Em cartaz", "Estreia em breve", "Já disponível" e "Sem data". Os grupos
 * ainda vêm do backend (`GET /watchlist`) e são juntados aqui, do lançamento
 * mais recente para o mais antigo — o que ainda vai estrear fica no topo — e
 * os sem data no fim. Cada item é o mesmo `PosterCard` das outras telas, com
 * a data de lançamento na pílula e os rostos de quem quer assistir no canto.
 */

type Escopo = '' | Pessoa | 'AMBOS';

export function QueroAssistirPage({
  perfil,
  aoNavegar,
}: {
  perfil: PerfilDoApp;
  aoNavegar: (para: string) => void;
}) {
  const eu = PESSOA_DO_PERFIL[perfil.id] ?? 'CAT';
  const perfis = useApi<{ itens: PerfilDoApp[] }>('/users');
  const outro = perfis.dados ? perfilDaPessoa(perfis.dados.itens, outraPessoa(eu)) : undefined;

  const [escopo, setEscopo] = useState<Escopo>('');
  const query = useMemo(() => (escopo ? { escopo } : {}), [escopo]);
  const lista = useApi<ListaQueroAssistir>('/watchlist', { query });

  const cards = useMemo(() => {
    const itens = lista.dados?.grupos.flatMap((g) => g.itens) ?? [];
    return ordenarPorLancamento(itens).map((item) => paraCard(item, perfis.dados?.itens ?? []));
  }, [lista.dados, perfis.dados]);

  const opcoes: Array<{ id: Escopo; rotulo: string }> = [
    { id: '', rotulo: 'Todos' },
    { id: eu, rotulo: 'Minha lista' },
    { id: outraPessoa(eu), rotulo: outro ? `De ${outro.nome}` : 'Do outro' },
    { id: 'AMBOS', rotulo: 'Os dois querem' },
  ];

  const total = lista.dados?.total ?? 0;

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <CabecalhoDaAba
        titulo="Quero assistir"
        subtitulo={lista.dados ? (total === 1 ? '1 filme' : `${total} filmes`) : null}
        aoAdicionar={() => aoNavegar('/adicionar')}
      />

      <div className={styles.pills} role="group" aria-label="De quem é a lista">
        {opcoes.map((o) => (
          <button
            key={o.id || 'todos'}
            type="button"
            className={escopo === o.id ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
            aria-pressed={escopo === o.id}
            onClick={() => setEscopo(o.id)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>

      <main className={styles.conteudo} aria-busy={lista.carregando}>
        {lista.erro && !lista.dados ? (
          <div className={styles.aviso} role="alert">
            <p>{lista.erro}</p>
            <button type="button" className={styles.tentar} onClick={lista.recarregar}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        {cards.length > 0 ? (
          <div className={styles.grade}>
            {cards.map((card) => (
              <PosterCard key={card.id} titulo={card} aoAbrir={(id) => aoNavegar(`/filme/${id}`)} />
            ))}
          </div>
        ) : null}

        {lista.dados && total === 0 ? (
          <div className={styles.aviso}>
            <p>
              {escopo
                ? 'Nada nesta lista.'
                : 'A lista está vazia. Marque "Quero assistir" num filme, ou adicione um pelo "+" — lançado ou não.'}
            </p>
            {!escopo ? (
              <button type="button" className={styles.tentar} onClick={() => aoNavegar('/adicionar')}>
                Adicionar filme
              </button>
            ) : null}
          </div>
        ) : null}
      </main>

      <BottomNav
        ativa="quero-assistir"
        aoNavegar={aoNavegar}
        aoTocarNaAtiva={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </div>
  );
}

/**
 * Do lançamento mais recente (ou futuro) para o mais antigo; sem data no fim.
 * O mesmo filme não se repete: a lista do backend tem um item por título.
 */
function ordenarPorLancamento(itens: ItemDaLista[]): ItemDaLista[] {
  return [...itens].sort((a, b) => {
    if (!a.estreia || !b.estreia) return a.estreia ? -1 : b.estreia ? 1 : a.titulo.localeCompare(b.titulo, 'pt-BR');
    return b.estreia.localeCompare(a.estreia) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
}

/**
 * Um item da lista no formato do `PosterCard`.
 *
 * - faixa: a data de lançamento (do Brasil, ou a mundial quando não há a
 *   daqui), na pílula do card — como a data em que assistiram, nos Assistidos;
 * - linha: o que a data quer dizer — em cartaz, ainda vai estrear, data
 *   mundial, sem data. "Os dois querem" já está nos dois rostos do canto.
 */
function paraCard(item: ItemDaLista, perfis: PerfilDoApp[]): CardDeTitulo {
  const marcadoPor = item.quem
    .map((q): MarcaDeUsuario | null => {
      const p = perfilDaPessoa(perfis, q.pessoa);
      return p ? { userId: PERFIL_DA_PESSOA[q.pessoa], inicial: p.inicial, acento: p.acento, nome: p.nome } : null;
    })
    .filter((m): m is MarcaDeUsuario => m !== null);

  const situacao =
    item.grupo === 'em_cartaz'
      ? 'Em cartaz agora'
      : item.grupo === 'estreia_em_breve'
        ? 'Ainda vai estrear'
        : item.grupo === 'sem_data'
          ? 'Sem data de lançamento'
          : null;
  const linha = [situacao, item.estreia && item.estreiaMundial ? 'data mundial' : null].filter(Boolean).join(' · ');

  return {
    id: item.titleId,
    titulo: item.titulo,
    posterUrl: item.posterUrl,
    ano: item.ano,
    orfao: item.orfao,
    imdb: item.imdb,
    rt: item.rt,
    linha: linha ? linha.charAt(0).toUpperCase() + linha.slice(1) : null,
    marcadoPor,
    faixa: item.estreia ? formatarDia(item.estreia) : null,
  };
}

function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}
