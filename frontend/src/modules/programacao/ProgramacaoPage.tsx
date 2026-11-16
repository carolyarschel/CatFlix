import { useEffect, useMemo, useRef, useState } from 'react';
import { IconeVoltar } from '../../shared/components/Icones';
import { RatingBadges } from '../../shared/components/RatingBadges';
import { SessaoBotao } from '../../shared/components/SessaoBotao';
import { useApi } from '../../shared/hooks/useApi';
import { formatarDuracao, formatarIdade } from '../../shared/formatos';
import type { DiaComSessao, FilmeDoDia, ProgramacaoDoDia } from '../../shared/api/tipos';
import styles from './ProgramacaoPage.module.scss';

/**
 * "O que dá para ver neste dia?" — todos os filmes de uma data nos cinemas
 * acompanhados, com os horários de cada um.
 *
 * A home responde "o que está em cartaz"; o detalhe, "onde passa este filme".
 * Faltava a pergunta de quem já escolheu o dia e não o filme: "sábado à noite,
 * o que tem?". Rota `/programacao/AAAA-MM-DD`; sem data, o backend responde
 * hoje (ou o próximo dia com sessão, se hoje já acabou).
 *
 * **O seletor de data são os dias que têm grade publicada**, não um calendário
 * livre: o ingresso publica cerca de duas semanas, e qualquer outro dia só
 * saberia responder "nada". Cada chip já diz quantos filmes tem.
 *
 * Trocar de dia **substitui** a URL em vez de empilhar: senão o voltar do
 * Android passearia pelos dias antes de sair da tela.
 */
export function ProgramacaoPage({
  diaInicial,
  aoVoltar,
  aoAbrir,
}: {
  diaInicial: string | null;
  aoVoltar: () => void;
  aoAbrir: (id: string) => void;
}) {
  const [dia, setDia] = useState<string | null>(diaInicial);
  const [cinema, setCinema] = useState<string | null>(null);

  const query = useMemo(() => (dia ? { date: dia } : {}), [dia]);
  const programacao = useApi<ProgramacaoDoDia>('/programacao', { query });
  const dados = programacao.dados;

  function escolherDia(novo: string) {
    setDia(novo);
    window.history.replaceState(null, '', `/programacao/${novo}`);
  }

  // o filtro de cinema sobrevive à troca de dia, mas só vale se o cinema
  // escolhido passa alguma coisa no dia novo — senão a lista ficaria vazia por
  // um motivo que a tela não mostra
  const cinemaAtivo = dados?.cinemas.some((c) => c.id === cinema) ? cinema : null;

  const filmes = useMemo(() => {
    if (!dados) return [];
    if (!cinemaAtivo) return dados.filmes;

    return dados.filmes
      .map((filme) => ({
        ...filme,
        sessoes: filme.sessoes.filter((c) => c.cinemaId === cinemaAtivo),
      }))
      .filter((filme) => filme.sessoes.length > 0);
  }, [dados, cinemaAtivo]);

  const totalDeSessoes = filmes.reduce(
    (n, f) => n + f.sessoes.reduce((m, c) => m + c.sessoes.length, 0),
    0,
  );

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
          <IconeVoltar />
        </button>

        <div className={styles.titulos}>
          <h1 className={styles.titulo}>Programação</h1>
          {dados ? (
            <p className={styles.contagem}>
              {rotuloLongoDoDia(dados.dia, dados.hoje)} · {contar(filmes.length, 'filme', 'filmes')}
              {' · '}
              {contar(totalDeSessoes, 'sessão', 'sessões')}
            </p>
          ) : null}
        </div>
      </header>

      {dados?.dados.degradado ? (
        <p className={styles.degradado} role="status">
          Dados de {formatarIdade(dados.dados.idadeEmHoras)} atrás — o último sync não chegou a
          atualizar.
        </p>
      ) : null}

      {programacao.carregando && !dados ? (
        <p className={styles.aviso}>Carregando…</p>
      ) : programacao.erro && !dados ? (
        <div className={styles.aviso} role="alert">
          <p>{programacao.erro}</p>
          <button type="button" className={styles.tentar} onClick={programacao.recarregar}>
            Tentar de novo
          </button>
        </div>
      ) : dados ? (
        <>
          <SeletorDeDia
            dias={dados.dias}
            hoje={dados.hoje}
            ativo={dados.dia}
            aoEscolher={escolherDia}
          />

          {/* um cinema só não é escolha */}
          {dados.cinemas.length > 1 ? (
            <div className={styles.cinemas} role="group" aria-label="Filtrar por cinema">
              <button
                type="button"
                className={!cinemaAtivo ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
                aria-pressed={!cinemaAtivo}
                onClick={() => setCinema(null)}
              >
                Todos
              </button>
              {dados.cinemas.map((c) => {
                const ativa = cinemaAtivo === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={ativa ? `${styles.pill} ${styles.pillAtiva}` : styles.pill}
                    aria-pressed={ativa}
                    title={c.nome}
                    // tocar no ativo volta para todos
                    onClick={() => setCinema(ativa ? null : c.id)}
                  >
                    {c.rede ?? c.nome}
                  </button>
                );
              })}
            </div>
          ) : null}

          {programacao.erro ? (
            <p className={styles.erro} role="alert">
              {programacao.erro}
            </p>
          ) : null}

          <main
            className={styles.lista}
            // trocando de dia, a lista anterior fica à vista, apagada, até a nova
            // chegar — piscar uma tela de "carregando" a cada toque cansa
            aria-busy={programacao.carregando}
            data-carregando={programacao.carregando || undefined}
          >
            {filmes.map((filme) => (
              <LinhaDoFilme key={filme.id} filme={filme} aoAbrir={aoAbrir} />
            ))}

            {filmes.length === 0 ? (
              <div className={styles.aviso}>
                <p>{mensagemDeVazio(dados)}</p>
              </div>
            ) : null}
          </main>
        </>
      ) : null}
    </div>
  );
}

function SeletorDeDia({
  dias,
  hoje,
  ativo,
  aoEscolher,
}: {
  dias: DiaComSessao[];
  hoje: string;
  ativo: string;
  aoEscolher: (dia: string) => void;
}) {
  const faixa = useRef<HTMLDivElement>(null);

  // Dia pedido pela URL que não tem sessão (ou que já passou) não está em
  // `dias`. Ele entra na faixa assim mesmo, marcado: sumir com o dia
  // selecionado deixaria a pessoa sem saber o que está vendo.
  const opcoes = useMemo(() => {
    if (dias.some((d) => d.dia === ativo)) return dias;
    return [...dias, { dia: ativo, filmes: 0 }].sort((a, b) => a.dia.localeCompare(b.dia));
  }, [dias, ativo]);

  // o dia ativo pode estar fora da tela (link para daqui a dez dias)
  useEffect(() => {
    faixa.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [ativo]);

  if (opcoes.length === 0) return null;

  return (
    <div ref={faixa} className={styles.dias} role="group" aria-label="Escolher o dia">
      {opcoes.map(({ dia, filmes }) => {
        const selecionado = dia === ativo;
        const { semana, data } = rotuloDoDia(dia, hoje);
        return (
          <button
            key={dia}
            type="button"
            className={selecionado ? `${styles.dia} ${styles.diaAtivo}` : styles.dia}
            aria-pressed={selecionado}
            aria-label={`${semana}, ${data}: ${contar(filmes, 'filme', 'filmes')}`}
            onClick={() => aoEscolher(dia)}
          >
            <span className={styles.semana}>{semana}</span>
            <span className={styles.data}>{data}</span>
            <span className={styles.quantos}>{filmes === 0 ? '—' : contar(filmes, 'filme', 'filmes')}</span>
          </button>
        );
      })}
    </div>
  );
}

function LinhaDoFilme({ filme, aoAbrir }: { filme: FilmeDoDia; aoAbrir: (id: string) => void }) {
  const meta = [
    filme.duracaoMinutos ? formatarDuracao(filme.duracaoMinutos) : null,
    filme.generos[0] ?? null,
  ].filter((p): p is string => Boolean(p));

  return (
    <article className={styles.filme}>
      <button
        type="button"
        className={styles.poster}
        onClick={() => aoAbrir(filme.id)}
        aria-label={`Abrir ${filme.titulo}`}
      >
        {filme.posterUrl ? (
          <img className={styles.imagem} src={filme.posterUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.semPoster}>sem pôster</span>
        )}

        {filme.marcadoPor.length > 0 ? (
          <span className={styles.marcas}>
            {filme.marcadoPor.map((m) => (
              <span key={m.userId} className={styles.marca} style={{ background: m.acento }}>
                {m.inicial}
              </span>
            ))}
          </span>
        ) : null}
      </button>

      <div className={styles.corpo}>
        <button type="button" className={styles.nome} onClick={() => aoAbrir(filme.id)}>
          {filme.titulo}
        </button>

        {meta.length > 0 || filme.orfao ? (
          <p className={styles.meta}>
            {meta.join(' • ')}
            {filme.orfao ? (
              <span className={styles.pendente}>{meta.length > 0 ? ' • ' : ''}metadata pendente</span>
            ) : null}
          </p>
        ) : null}

        <RatingBadges imdb={filme.imdb} rt={filme.rt} />

        {filme.sessoes.map((cinema) => (
          <div key={cinema.cinemaId} className={styles.cinema}>
            <p className={styles.nomeDoCinema} title={cinema.cinema}>
              {cinema.rede ?? cinema.cinema}
            </p>
            <ul className={styles.horarios}>
              {cinema.sessoes.map((sessao) => (
                <li key={sessao.id}>
                  <SessaoBotao sessao={sessao} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  );
}

function mensagemDeVazio(dados: ProgramacaoDoDia): string {
  if (dados.dias.length === 0) {
    return 'Nenhuma sessão futura publicada nos cinemas acompanhados. Sincronize para buscar a grade nova.';
  }
  if (dados.dia === dados.hoje) return 'As sessões de hoje já começaram todas. Escolha outro dia acima.';
  if (dados.dia < dados.hoje) return 'Esse dia já passou. Escolha um dia acima.';
  return 'Nenhuma sessão publicada para esse dia ainda — o ingresso.com abre a grade cerca de duas semanas antes.';
}

// ── formatação ───────────────────────────────────────────────

/**
 * Diferença em dias entre duas datas `AAAA-MM-DD`.
 *
 * As duas vêm do backend no fuso da cidade, e a conta é feita em UTC dos dois
 * lados — `new Date('2026-09-24')` comparado com o relógio do aparelho daria
 * "amanhã" para hoje depois das 21h no Brasil.
 */
function diasEntre(de: string, ate: string): number {
  const utc = (d: string) => {
    const [a, m, dd] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(a, m - 1, dd);
  };
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

function dataUtc(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d));
}

/** `{ semana: "Hoje" | "Amanhã" | "Qua", data: "18 nov" }` */
function rotuloDoDia(dia: string, hoje: string): { semana: string; data: string } {
  const data = dataUtc(dia);
  const distancia = diasEntre(hoje, dia);

  const semana =
    distancia === 0
      ? 'Hoje'
      : distancia === 1
        ? 'Amanhã'
        : capitalizar(
            data.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
          );

  return {
    semana,
    data: data
      .toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .replace(' de ', ' ')
      .replace('.', ''),
  };
}

/** "Hoje, 16 nov" / "Sábado, 21 nov" — para o subtítulo da tela. */
function rotuloLongoDoDia(dia: string, hoje: string): string {
  const { semana, data } = rotuloDoDia(dia, hoje);
  if (semana === 'Hoje' || semana === 'Amanhã') return `${semana}, ${data}`;

  const extenso = dataUtc(dia).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  return `${capitalizar(extenso.replace('-feira', ''))}, ${data}`;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function contar(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}
