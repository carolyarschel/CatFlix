import { useMemo, useState } from 'react';
import { SessaoBotao } from '../../shared/components/SessaoBotao';
import { formatarDia } from '../../shared/dias';
import { filtrarPorSala, salasDasSessoes } from '../../shared/salas';
import type { SessaoDoDia, SessoesPorCinema } from '../../shared/api/tipos';
import styles from './SessoesDoFilme.module.scss';

/**
 * As sessões de um filme: filtro por tipo de sala e os horários por cinema e
 * por dia. Saiu do detalhe antigo (`FilmePage`) inteira, para o detalhe do
 * acervo usar o mesmo bloco quando o filme está em cartaz (cineon-expansao
 * §7, item 12).
 */
export function SessoesDoFilme({ sessoes }: { sessoes: SessoesPorCinema[] }) {
  const [sala, setSala] = useState<string | null>(null);

  const total = sessoes.reduce((n, c) => n + c.sessoes.length, 0);
  // as salas que ESTE filme tem — ver `shared/salas.ts`
  const salas = useMemo(() => salasDasSessoes(sessoes), [sessoes]);
  const filtradas = useMemo(() => filtrarPorSala(sessoes, sala), [sessoes, sala]);
  const totalFiltrado = filtradas.reduce((n, c) => n + c.sessoes.length, 0);

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>
        Sessões
        {total > 0 ? (
          <span className={styles.contagem}>{sala ? `${totalFiltrado} de ${total}` : total}</span>
        ) : null}
      </h2>

      {/* um formato só faz sentido quando há mais de um para escolher */}
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
                // tocar na ativa volta a mostrar tudo
                onClick={() => setSala(ativa ? null : opcao)}
              >
                {opcao}
              </button>
            );
          })}
        </div>
      ) : null}

      {total === 0 ? (
        <p className={styles.vazio}>
          Nenhuma sessão futura nos cinemas acompanhados. Quando entrar em cartaz, aparece aqui.
        </p>
      ) : (
        filtradas.map((cinema) => <BlocoDeCinema key={cinema.cinemaId} cinema={cinema} />)
      )}
    </section>
  );
}

/**
 * As sessões de um cinema, agrupadas por dia.
 *
 * **Por que nem todos os dias de uma vez:** o ingresso publica a grade de duas
 * semanas, e um filme popular chega a 160 sessões futuras. Três dias cobrem a
 * pergunta real ("vou hoje, amanhã ou no fim de semana?"), e o resto continua a
 * um toque.
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
