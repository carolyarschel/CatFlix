import { useMemo, useState } from 'react';
import { IconeIngresso, IconeVoltar } from '../../shared/components/Icones';
import { RatingBadges } from '../../shared/components/RatingBadges';
import { useApi } from '../../shared/hooks/useApi';
import { useEstadoDoTitulo } from '../../shared/hooks/useEstadoDoTitulo';
import { TagsManuais } from '../tags/TagsManuais';
import type {
  DetalheDoTitulo,
  PerfilDoApp,
  SessaoDoDia,
  SessoesPorCinema,
  StatusDeUsuario,
} from '../../shared/api/tipos';
import styles from './FilmePage.module.scss';

/**
 * Detalhe do filme (§1: "clique no card abre o detalhe completo, com botão que
 * leva à página do filme no ingresso.com").
 *
 * Sem modelo de design, e pela decisão de 23/09/2026 (§3) isso significa seguir
 * o estilo das telas existentes em vez de propor layout antes: mesmos tokens,
 * mesmos botões de largura total do HeroCard, mesmo `RatingBadges`.
 *
 * A ordem da página é a ordem da decisão: o que é, se presta, onde passa, e só
 * depois quem fez. Sessão vem antes de elenco porque o app existe para decidir
 * ir ao cinema hoje.
 */

const APELIDO_DO_PAR: Record<string, string> = {
  catflix: 'Marcar com o Urso',
  hburso: 'Marcar com a Gata',
};

/**
 * Os três estados do §6.
 *
 * "Marcado" é o do botão do §12 e quer dizer *combinamos de ir* — por isso o
 * rótulo dele é o apelido da outra pessoa, e não "marcado".
 */
/**
 * Rótulo da sala sem formato.
 *
 * O backend manda `sala: null` para sala comum, porque no detalhe escrever
 * "Normal" em cada horário só ocuparia espaço. No filtro ela precisa de nome:
 * "só as comuns" é justamente o que se pede para não pagar VIP.
 */
const SALA_COMUM = 'Comum';

const ESTADOS: Array<{ id: StatusDeUsuario; rotulo: string }> = [
  { id: 'quero_ver', rotulo: 'Quero ver' },
  { id: 'marcado', rotulo: 'Marcado' },
  { id: 'visto', rotulo: 'Já vi' },
];

const MOTIVO: Record<string, string> = {
  low_confidence: 'o candidato encontrado não teve nota suficiente',
  no_candidate: 'nenhum candidato foi encontrado no TMDB',
  possible_duplicate: 'pode ser o mesmo filme de outro título já no catálogo',
  probable_non_film: 'pode não ser um filme (show, ópera, transmissão)',
};

export function FilmePage({
  id,
  perfil,
  aoVoltar,
}: {
  id: string;
  perfil: PerfilDoApp;
  aoVoltar: () => void;
}) {
  const filme = useApi<DetalheDoTitulo>(`/titles/${id}`);
  const dados = filme.dados;

  if (filme.carregando && !dados) {
    return <p className={styles.aviso}>Carregando…</p>;
  }

  if (filme.erro || !dados) {
    return (
      <div className={styles.tela}>
        <Cabecalho aoVoltar={aoVoltar} />
        <div className={styles.aviso} role="alert">
          <p>{filme.erro ?? 'Não consegui carregar este filme.'}</p>
          <button type="button" className={styles.tentar} onClick={filme.recarregar}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  // `key` remonta o conteúdo ao trocar de filme, e é o que garante que o estado
  // otimista da marcação comece do dado novo em vez de herdar o anterior
  return <Conteudo key={dados.id} dados={dados} perfil={perfil} aoVoltar={aoVoltar} />;
}

function Conteudo({
  dados,
  perfil,
  aoVoltar,
}: {
  dados: DetalheDoTitulo;
  perfil: PerfilDoApp;
  aoVoltar: () => void;
}) {
  const marcacao = useEstadoDoTitulo(perfil, dados.id, dados.estados);
  const [sala, setSala] = useState<string | null>(null);

  const taxonomia = useMemo(
    () =>
      [
        'Filme',
        ...dados.generos.slice(0, 2),
        dados.duracaoMinutos ? formatarDuracao(dados.duracaoMinutos) : null,
        dados.ano ? String(dados.ano) : null,
      ].filter((p): p is string => Boolean(p)),
    [dados],
  );

  const totalDeSessoes = dados.sessoes.reduce((n, c) => n + c.sessoes.length, 0);

  /**
   * As salas que ESTE filme tem, na ordem em que aparecem.
   *
   * Sai das sessões do próprio filme, não da lista global de formatos: oferecer
   * "IMAX" num filme que não passa em IMAX seria um filtro que só sabe devolver
   * vazio. Sala comum entra como "Comum" porque ela é uma escolha — quem não
   * quer pagar VIP precisa conseguir pedir só as normais.
   */
  const salas = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const cinema of dados.sessoes) {
      for (const sessao of cinema.sessoes) {
        const chave = sessao.sala ?? SALA_COMUM;
        if (!vistas.has(chave)) vistas.set(chave, chave);
        if (sessao.is3d && !vistas.has('3D')) vistas.set('3D', '3D');
      }
    }
    return [...vistas.keys()];
  }, [dados.sessoes]);

  const sessoesFiltradas = useMemo(() => {
    if (!sala) return dados.sessoes;

    return dados.sessoes
      .map((cinema) => ({
        ...cinema,
        sessoes: cinema.sessoes.filter((s) =>
          sala === '3D' ? s.is3d : (s.sala ?? SALA_COMUM) === sala,
        ),
      }))
      // cinema sem nenhuma sessão do formato escolhido sai da lista: um nome de
      // cinema com nada embaixo parece defeito
      .filter((cinema) => cinema.sessoes.length > 0);
  }, [dados.sessoes, sala]);

  const totalFiltrado = sessoesFiltradas.reduce((n, c) => n + c.sessoes.length, 0);

  return (
    <div className={styles.tela}>
      <div
        className={styles.ambiente}
        style={dados.backdropUrl ? { backgroundImage: `url(${dados.backdropUrl})` } : undefined}
        aria-hidden="true"
      />

      <Cabecalho aoVoltar={aoVoltar} />

      <header className={styles.capa}>
        <div className={styles.poster}>
          {dados.posterUrl ? (
            <img className={styles.imagem} src={dados.posterUrl} alt="" decoding="async" />
          ) : (
            <span className={styles.semPoster}>sem pôster</span>
          )}
        </div>

        <div className={styles.identidade}>
          <h1 className={styles.titulo}>{dados.titulo}</h1>

          {/* só quando difere: repetir o mesmo nome duas vezes não informa nada */}
          {dados.tituloOriginal && dados.tituloOriginal !== dados.titulo ? (
            <p className={styles.original}>{dados.tituloOriginal}</p>
          ) : null}

          <p className={styles.taxonomia}>
            {taxonomia.map((parte, indice) => (
              <span key={parte} className={indice === 0 ? styles.destaque : undefined}>
                {indice > 0 ? <span className={styles.separador}>•</span> : null}
                {parte}
              </span>
            ))}
          </p>

          <RatingBadges imdb={dados.notas.imdb} rt={dados.notas.rt} />

          {marcacao.estados.length > 0 ? (
            <ul className={styles.marcas}>
              {marcacao.estados.map((estado) => (
                <li key={estado.userId} className={styles.marca}>
                  <span className={styles.inicial} style={{ background: estado.acento }}>
                    {estado.inicial}
                  </span>
                  {rotuloDeEstado(estado.status)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      {/* §2: o órfão aparece, e diz por que está sem metadata */}
      {dados.orfao ? (
        <p className={styles.pendente} role="status">
          Metadata pendente
          {dados.pendencia ? ` — ${MOTIVO[dados.pendencia.motivo] ?? 'está na fila de revisão'}` : null}
          . O filme continua aqui; as sessões abaixo são as de verdade.
        </p>
      ) : null}

      <div className={styles.acoes}>
        {/* o botão do §1. Some quando não há URL, em vez de levar a lugar nenhum */}
        {dados.ingressoUrl ? (
          <a
            className={styles.primario}
            href={dados.ingressoUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <IconeIngresso tamanho={19} />
            Ver no ingresso.com
          </a>
        ) : null}

        <button
          type="button"
          className={
            marcacao.meuStatus === 'marcado'
              ? `${styles.secundario} ${styles.secundarioAtivo}`
              : styles.secundario
          }
          aria-pressed={marcacao.meuStatus === 'marcado'}
          disabled={marcacao.salvando}
          onClick={() =>
            void marcacao.definir(marcacao.meuStatus === 'marcado' ? null : 'marcado')
          }
        >
          {marcacao.meuStatus === 'marcado'
            ? 'Marcado — tocar para desmarcar'
            : (APELIDO_DO_PAR[perfil.id] ?? 'Marcar')}
        </button>

        {/* os outros dois estados do §6, que o botão do modelo não cobre */}
        <div className={styles.estados} role="group" aria-label="O que você diz deste filme">
          {ESTADOS.map((estado) => {
            const ativo = marcacao.meuStatus === estado.id;
            return (
              <button
                key={estado.id}
                type="button"
                className={ativo ? `${styles.estado} ${styles.estadoAtivo}` : styles.estado}
                aria-pressed={ativo}
                disabled={marcacao.salvando}
                // tocar no estado ativo desmarca: sem isso, marcar sem querer
                // não teria volta
                onClick={() => void marcacao.definir(ativo ? null : estado.id)}
              >
                {estado.rotulo}
              </button>
            );
          })}
        </div>

        {marcacao.erro ? (
          <p className={styles.erro} role="alert">
            {marcacao.erro}
          </p>
        ) : null}
      </div>

      {dados.sinopse ? (
        <section className={styles.bloco}>
          <h2 className={styles.rotulo}>Sinopse</h2>
          <p className={styles.sinopse}>{dados.sinopse}</p>
        </section>
      ) : null}

      <section className={styles.bloco}>
        <h2 className={styles.rotulo}>
          Sessões
          {totalDeSessoes > 0 ? (
            <span className={styles.contagem}>
              {sala ? `${totalFiltrado} de ${totalDeSessoes}` : totalDeSessoes}
            </span>
          ) : null}
        </h2>

        {/* Um formato só faz sentido quando há mais de um para escolher. */}
        {salas.length > 1 ? (
          <div className={styles.salas} role="group" aria-label="Filtrar sessões por tipo de sala">
            {salas.map((opcao) => {
              const ativa = sala === opcao;
              return (
                <button
                  key={opcao}
                  type="button"
                  className={ativa ? `${styles.sala} ${styles.salaAtiva}` : styles.sala}
                  aria-pressed={ativa}
                  // tocar na ativa volta a mostrar tudo: sem isso, limpar o
                  // filtro exigiria adivinhar que existe um "todas" escondido
                  onClick={() => setSala(ativa ? null : opcao)}
                >
                  {opcao}
                </button>
              );
            })}
          </div>
        ) : null}

        {totalDeSessoes === 0 ? (
          <p className={styles.vazio}>
            Nenhuma sessão futura nos cinemas acompanhados. Quando entrar em cartaz, aparece aqui.
          </p>
        ) : (
          sessoesFiltradas.map((cinema) => <BlocoDeCinema key={cinema.cinemaId} cinema={cinema} />)
        )}
      </section>

      <TagsManuais titleId={dados.id} perfil={perfil} iniciais={dados.tags} />

      <Ficha
        diretores={dados.diretores}
        elenco={dados.elenco}
        estudios={dados.estudios}
        generos={dados.generos}
      />
    </div>
  );
}

/**
 * As sessões de um cinema, agrupadas por dia.
 *
 * **Por que nem todos os dias de uma vez:** o ingresso publica a grade de duas
 * semanas, e um filme popular chega a 160 sessões futuras. Despejadas de uma
 * vez, elas empurram sinopse, tags e elenco para depois de uns quinze scrolls —
 * a página deixa de ser o detalhe do filme e vira uma lista de horários. Três
 * dias cobrem a pergunta real ("vou hoje, amanhã ou no fim de semana?"), e o
 * resto continua a um toque.
 */
const DIAS_VISIVEIS = 3;

function BlocoDeCinema({ cinema }: { cinema: SessoesPorCinema }) {
  const [tudo, setTudo] = useState(false);

  const dias = useMemo(() => agruparPorDia(cinema.sessoes), [cinema.sessoes]);
  const mostrados = tudo ? dias : dias.slice(0, DIAS_VISIVEIS);
  const escondidos = dias.length - mostrados.length;

  return (
    <div className={styles.cinema}>
      <h3 className={styles.nomeDoCinema}>{cinema.cinema}</h3>

      {mostrados.map(([dia, sessoes]) => (
        <div key={dia} className={styles.dia}>
          <p className={styles.nomeDoDia}>{formatarDia(dia)}</p>

          <ul className={styles.horarios}>
            {sessoes.map((sessao) => (
              <li key={sessao.id}>
                <SessaoBotao sessao={sessao} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {escondidos > 0 ? (
        <button type="button" className={styles.maisDias} onClick={() => setTudo(true)}>
          {escondidos === 1 ? 'Mais 1 dia' : `Mais ${escondidos} dias`}
        </button>
      ) : null}

      {tudo && dias.length > DIAS_VISIVEIS ? (
        <button type="button" className={styles.maisDias} onClick={() => setTudo(false)}>
          Mostrar menos
        </button>
      ) : null}
    </div>
  );
}

function Cabecalho({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <div className={styles.cabecalho}>
      <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
        <IconeVoltar />
      </button>
    </div>
  );
}

/**
 * Uma sessão.
 *
 * Vira link quando há URL de compra e um `span` quando não há — um botão que
 * não faz nada é pior do que um horário que só informa.
 *
 * ⚠️ **O tipo da sessão não aparece de propósito.** `sessionKind` sai de
 * `inPreSale`, que no ingresso é pré-venda e não pré-estreia: 434 das 504
 * sessões futuras estão marcadas como `pre_estreia`, inclusive as de filme que
 * já estreou (pendência 1 do README). Carimbar "Pré-estreia" em tudo seria pior
 * do que não dizer nada.
 */
function SessaoBotao({ sessao }: { sessao: SessaoDoDia }) {
  const detalhes = [sessao.sala, sessao.is3d ? '3D' : null, sessao.audioRotulo]
    .filter(Boolean)
    .join(' · ');

  const conteudo = (
    <>
      <span className={styles.hora}>{sessao.horario}</span>
      {detalhes ? <span className={styles.detalhes}>{detalhes}</span> : null}
    </>
  );

  if (!sessao.urlCompra) {
    return (
      <span className={`${styles.sessao} ${styles.sessaoSemLink}`} title="Sem link de compra">
        {conteudo}
      </span>
    );
  }

  return (
    <a
      className={styles.sessao}
      href={sessao.urlCompra}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Comprar ingresso para a sessão das ${sessao.horario}${detalhes ? `, ${detalhes}` : ''}`}
    >
      {conteudo}
    </a>
  );
}

function Ficha({
  diretores,
  elenco,
  estudios,
  generos,
}: {
  diretores: Array<{ nome: string }>;
  elenco: Array<{ nome: string; personagem: string | null }>;
  estudios: string[];
  generos: string[];
}) {
  const linhas: Array<[string, string]> = [];

  if (diretores.length > 0) {
    linhas.push([diretores.length > 1 ? 'Direção' : 'Diretor', diretores.map((d) => d.nome).join(', ')]);
  }
  if (generos.length > 0) linhas.push(['Gêneros', generos.join(', ')]);
  if (estudios.length > 0) linhas.push(['Estúdio', estudios.join(', ')]);

  if (linhas.length === 0 && elenco.length === 0) return null;

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>Ficha</h2>

      <dl className={styles.ficha}>
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className={styles.linhaDaFicha}>
            <dt className={styles.termo}>{rotulo}</dt>
            <dd className={styles.valor}>{valor}</dd>
          </div>
        ))}
      </dl>

      {elenco.length > 0 ? (
        <ul className={styles.elenco}>
          {elenco.map((pessoa) => (
            <li key={`${pessoa.nome}-${pessoa.personagem ?? ''}`} className={styles.pessoa}>
              <span className={styles.nomeDaPessoa}>{pessoa.nome}</span>
              {pessoa.personagem ? (
                <span className={styles.personagem}>{pessoa.personagem}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Agrupa preservando a ordem cronológica que o backend já devolveu. */
function agruparPorDia(sessoes: SessaoDoDia[]): Array<[string, SessaoDoDia[]]> {
  const porDia = new Map<string, SessaoDoDia[]>();
  for (const sessao of sessoes) {
    const lista = porDia.get(sessao.dia) ?? [];
    lista.push(sessao);
    porDia.set(sessao.dia, lista);
  }
  return [...porDia.entries()];
}

/** "2h18" — minuto puro ("138 min") obriga a pessoa a fazer a conta. */
function formatarDuracao(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}

/**
 * "Hoje", "Amanhã" ou "Sáb, 27 set".
 *
 * O dia vem como `AAAA-MM-DD` no fuso da CIDADE, e é comparado com o hoje do
 * aparelho montando as duas datas do mesmo jeito. `new Date('2026-09-24')` seria
 * meia-noite UTC, e no Brasil isso é o dia anterior às 21h — "hoje" viraria
 * "amanhã" no fim da tarde, justamente quando se olha sessão.
 */
function formatarDia(dia: string): string {
  const [ano, mes, data] = dia.split('-').map(Number);
  if (!ano || !mes || !data) return dia;

  const alvo = new Date(ano, mes - 1, data);
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';

  return alvo
    .toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.,', ',')
    .replace(/\.$/, '');
}

function rotuloDeEstado(status: string): string {
  if (status === 'quero_ver') return 'quer ver';
  if (status === 'visto') return 'já viu';
  return 'marcou';
}
