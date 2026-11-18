import { useMemo, useState } from 'react';
import { BottomNav } from '../../shared/components/BottomNav';
import { CabecalhoDaAba } from '../../shared/components/CabecalhoDaAba';
import { Trilha } from '../../shared/components/Trilha';
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
 * A aba "Quero assistir" (cineon-expansao §8): trilhas "Em cartaz agora",
 * "Estreia em breve" (pela data), "Já disponível" e "Sem data", com o filtro
 * minha / dele / dos dois.
 *
 * As trilhas e a ordem vêm prontas do backend (`GET /watchlist`); aqui cada
 * item vira o mesmo `PosterCard` das outras telas (§8), com os rostos de quem
 * quer assistir no canto.
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

  const grupos = useMemo(
    () =>
      lista.dados?.grupos.map((g) => ({
        ...g,
        cards: g.itens.map((item) => paraCard(item, perfis.dados?.itens ?? [])),
      })) ?? [],
    [lista.dados, perfis.dados],
  );

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

      <main className={styles.trilhas} aria-busy={lista.carregando}>
        {lista.erro && !lista.dados ? (
          <div className={styles.aviso} role="alert">
            <p>{lista.erro}</p>
            <button type="button" className={styles.tentar} onClick={lista.recarregar}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        {grupos.map((g) => (
          <Trilha
            key={g.id}
            id={g.id}
            titulo={g.titulo}
            itens={g.cards}
            total={g.cards.length}
            aoAbrir={(id) => aoNavegar(`/filme/${id}`)}
          />
        ))}

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
 * Um item da lista no formato do `PosterCard`.
 *
 * - faixa: "Os dois querem" — é a informação que a lista existe para dar;
 * - linha: a estreia, quando ela ainda vai acontecer ou quando não há data.
 */
function paraCard(item: ItemDaLista, perfis: PerfilDoApp[]): CardDeTitulo {
  const marcadoPor = item.quem
    .map((q): MarcaDeUsuario | null => {
      const p = perfilDaPessoa(perfis, q.pessoa);
      return p ? { userId: PERFIL_DA_PESSOA[q.pessoa], inicial: p.inicial, acento: p.acento, nome: p.nome } : null;
    })
    .filter((m): m is MarcaDeUsuario => m !== null);

  const linha =
    item.grupo === 'estreia_em_breve' && item.estreia
      ? `Estreia ${formatarDia(item.estreia)}${item.estreiaMundial ? ' (mundial)' : ''}`
      : item.grupo === 'sem_data'
        ? 'Sem data de estreia'
        : null;

  return {
    id: item.titleId,
    titulo: item.titulo,
    posterUrl: item.posterUrl,
    ano: item.ano,
    orfao: item.orfao,
    imdb: item.imdb,
    rt: item.rt,
    linha,
    marcadoPor,
    faixa: item.quem.length === 2 ? 'Os dois querem' : null,
  };
}

function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}
