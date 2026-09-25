import { useMemo, useState } from 'react';
import { Badge } from '../../shared/components/Badge';
import { BottomNav } from '../../shared/components/BottomNav';
import { HeroCard } from '../../shared/components/HeroCard';
import { IconeBusca, IconeRevisar, IconeSeta } from '../../shared/components/Icones';
import { PillFilter } from '../../shared/components/PillFilter';
import { Trilha } from '../../shared/components/Trilha';
import { useApi } from '../../shared/hooks/useApi';
import type {
  ContagemDaRevisao,
  Home,
  ListaDeTitulos,
  PerfilDoApp,
  StatusDeDisponibilidade,
} from '../../shared/api/tipos';
import { PosterCard } from '../../shared/components/PosterCard';
import { TagsPanel } from '../tags/TagsPanel';
import styles from './HomePage.module.scss';

/**
 * Home do app (§12), na direção mobile — que desde 23/09/2026 manda também no
 * desktop (§3).
 *
 * Estrutura: cabeçalho, pills de filtro, hero e trilhas horizontais. Tudo vem
 * pronto de `GET /home?user=`: agrupar no backend evita que a tela mais aberta
 * do app faça quatro requisições e monte as trilhas no celular.
 */

/**
 * Cada pill mostra uma trilha; o id casa com o `id` que o backend devolve.
 *
 * `disponibilidade` é o mesmo recorte traduzido para o `?availability=` de
 * `GET /titles` — a pill precisa continuar valendo quando a home vira lista
 * filtrada por tag, e as duas leituras têm de concordar sobre o que é "em
 * cartaz".
 */
const FILTROS: Array<{ id: string; rotulo: string; disponibilidade: StatusDeDisponibilidade }> = [
  { id: 'em-cartaz', rotulo: 'Em cartaz', disponibilidade: 'em_cartaz' },
  { id: 'pre-estreias', rotulo: 'Pré-estreias', disponibilidade: 'pre_estreia' },
  { id: 'em-breve', rotulo: 'Em breve', disponibilidade: 'em_breve' },
];

export function HomePage({
  perfil,
  aoNavegar,
}: {
  perfil: PerfilDoApp;
  aoNavegar: (para: string) => void;
}) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const [secaoAtiva, setSecaoAtiva] = useState('inicio');
  const [painelDeTags, setPainelDeTags] = useState(false);
  /** ids qualificados vindos do painel: `sala:imax` */
  const [tags, setTags] = useState<string[]>([]);

  // o perfil já vem da sessão; a query existe só para o cache do hook saber
  // que trocar de pessoa é outra home
  const query = useMemo(() => ({ user: perfil.id }), [perfil.id]);
  const home = useApi<Home>('/home', { query });
  const revisao = useApi<ContagemDaRevisao>('/review/count');

  const filtrando = tags.length > 0;

  // Com tag ligada a home deixa de ser hero + trilhas e vira uma grade de
  // resultados: as trilhas do `/home` são recortes fixos do backend e não
  // sabem de tag. `ativo` evita buscar a lista enquanto não há filtro.
  const queryDaLista = useMemo(() => {
    const disponibilidade = FILTROS.find((f) => f.id === filtro)?.disponibilidade;
    return { tag: tags, ...(disponibilidade ? { availability: disponibilidade } : {}) };
  }, [tags, filtro]);

  const lista = useApi<ListaDeTitulos>('/titles', { query: queryDaLista, ativo: filtrando });

  const dados = home.dados;

  const trilhas = useMemo(() => {
    if (!dados) return [];
    return filtro ? dados.trilhas.filter((t) => t.id === filtro) : dados.trilhas;
  }, [dados, filtro]);

  const abrirFilme = (idDoFilme: string) => aoNavegar(`/filme/${idDoFilme}`);

  function irPara(destino: string) {
    setSecaoAtiva(destino);

    if (destino === 'inicio') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // a âncora só existe se a trilha foi renderizada; com o filtro ligado numa
    // outra trilha — ou com tag ligada, que troca as trilhas por uma grade —,
    // limpar o filtro primeiro é o que a pessoa espera
    setFiltro(null);
    setTags([]);
    requestAnimationFrame(() => {
      document.getElementById(destino)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (home.carregando && !dados) {
    return <p className={styles.aviso}>Carregando…</p>;
  }

  if (home.erro || !dados) {
    return (
      <div className={styles.aviso} role="alert">
        <p>{home.erro ?? 'Não consegui carregar a home.'}</p>
        <button type="button" className={styles.tentar} onClick={home.recarregar}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const pendencias = revisao.dados?.total ?? 0;

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <div className={styles.marca}>
          <span className={styles.inicial}>{dados.perfil.inicial}</span>
          <h1 className={styles.titulo}>Início</h1>
        </div>

        <div className={styles.acoes}>
          <button
            type="button"
            className={styles.acao}
            aria-label="Buscar filme"
            disabled
            title="A busca entra depois no passo 10"
          >
            <IconeBusca />
          </button>

          {/* §2: sem pendência, o item não é renderizado — nem cinza, nem vazio */}
          {pendencias > 0 ? (
            <button
              type="button"
              className={styles.acao}
              aria-label={`Fila de revisão, ${pendencias} pendências`}
              onClick={() => aoNavegar('/revisar')}
            >
              <IconeRevisar />
              <Badge valor={pendencias} />
            </button>
          ) : null}
        </div>
      </header>

      {dados.dados.degradado ? (
        <p className={styles.degradado} role="status">
          Dados de {formatarIdade(dados.dados.idadeEmHoras)} atrás — o último sync não chegou a
          atualizar.
        </p>
      ) : null}

      <PillFilter
        opcoes={FILTROS}
        ativa={filtro}
        aoEscolher={(id) => setFiltro((atual) => (atual === id ? null : id))}
        extra={
          <button
            type="button"
            className={filtrando ? `${styles.pillTags} ${styles.pillTagsAtiva}` : styles.pillTags}
            aria-expanded={painelDeTags}
            aria-haspopup="dialog"
            onClick={() => setPainelDeTags(true)}
          >
            {filtrando ? `Tags · ${tags.length}` : 'Tags'}
            <IconeSeta tamanho={15} />
          </button>
        }
      />

      {dados.hero && !filtro && !filtrando ? (
        <div className={styles.heroArea}>
          <HeroCard
            hero={dados.hero}
            perfil={dados.perfil.id}
            aoVerSessoes={abrirFilme}
            // Marcar leva ao detalhe em vez de escrever daqui: lá a pessoa vê
            // os três estados do §6, o que já está marcado e como desmarcar. Um
            // toque que grava direto da home tornaria "marquei sem querer" um
            // beco sem saída — o hero não tem onde mostrar o desfazer.
            aoMarcar={abrirFilme}
          />
        </div>
      ) : null}

      {filtrando ? (
        <main className={styles.resultados}>
          <h2 className={styles.tituloDaGrade}>
            {lista.dados ? contarResultados(lista.dados.total) : 'Filtrando…'}
          </h2>

          {lista.erro ? (
            <div className={styles.aviso} role="alert">
              <p>{lista.erro}</p>
              <button type="button" className={styles.tentar} onClick={lista.recarregar}>
                Tentar de novo
              </button>
            </div>
          ) : null}

          {lista.dados ? (
            <div className={styles.grade}>
              {lista.dados.itens.map((item) => (
                <PosterCard key={item.id} titulo={item} aoAbrir={abrirFilme} />
              ))}
            </div>
          ) : null}

          {/* combinação vazia é resposta legítima, não erro: o caminho de volta
              precisa estar ali mesmo */}
          {lista.dados && lista.dados.itens.length === 0 ? (
            <div className={styles.aviso}>
              <p>Nenhum filme com todas essas tags ao mesmo tempo.</p>

              {/* Sala, cinema e áudio saem das SESSÕES. Filme que ainda não
                  estreou não tem sessão, então não tem nenhuma dessas tags — e
                  "Em breve" com tag dá vazio quase sempre. Dizer isso é mais
                  útil do que deixar a pessoa achando que o filtro quebrou. */}
              {filtro === 'em-breve' ? (
                <p className={styles.explicacao}>
                  Sala, cinema e áudio vêm das sessões, e o que ainda não estreou não tem
                  sessão — por isso "Em breve" quase não cruza com tag.
                </p>
              ) : null}

              <div className={styles.saidas}>
                <button type="button" className={styles.tentar} onClick={() => setTags([])}>
                  Limpar as tags
                </button>

                {filtro ? (
                  <button type="button" className={styles.secundario} onClick={() => setFiltro(null)}>
                    Tirar o filtro de {FILTROS.find((f) => f.id === filtro)?.rotulo.toLowerCase()}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </main>
      ) : (
        <main className={styles.trilhas}>
          {trilhas.map((trilha) => (
            <Trilha
              key={trilha.id}
              id={trilha.id}
              titulo={trilha.titulo}
              itens={trilha.itens}
              total={trilha.total}
              aoAbrir={abrirFilme}
              aoVerTodos={(id) => aoNavegar(`/lista/${id}`)}
            />
          ))}

          {trilhas.length === 0 ? (
            <p className={styles.aviso}>
              Nada por aqui ainda. Rode um sync para popular o catálogo.
            </p>
          ) : null}
        </main>
      )}

      <BottomNav
        perfil={dados.perfil}
        ativo={secaoAtiva}
        aoIrPara={irPara}
        aoAbrirPerfil={() => aoNavegar('/perfil')}
      />

      {painelDeTags ? (
        <TagsPanel
          selecionadas={tags}
          aoAlternar={(id) =>
            setTags((atuais) =>
              atuais.includes(id) ? atuais.filter((t) => t !== id) : [...atuais, id],
            )
          }
          aoLimpar={() => setTags([])}
          aoFechar={() => setPainelDeTags(false)}
        />
      ) : null}

    </div>
  );
}

function contarResultados(total: number): string {
  if (total === 0) return 'Nenhum filme';
  return total === 1 ? '1 filme' : `${total} filmes`;
}

/** "3 horas", "2 dias" — o aviso do modo degradado não precisa de precisão decimal. */
function formatarIdade(horas: number | null): string {
  if (horas === null) return 'um tempo';
  if (horas < 1) return 'menos de uma hora';
  if (horas < 24) {
    const inteiras = Math.round(horas);
    return inteiras === 1 ? '1 hora' : `${inteiras} horas`;
  }

  const dias = Math.round(horas / 24);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}
