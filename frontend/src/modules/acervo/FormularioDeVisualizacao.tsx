import { useMemo, useState } from 'react';
import { useApi } from '../../shared/hooks/useApi';
import { perfilDaPessoa } from '../../shared/pessoas';
import type {
  CinemaDaLista,
  DadosDaVisualizacao,
  LocalDaVisualizacao,
  PerfilDoApp,
  Pessoa,
  PrecisaoDaData,
} from '../../shared/api/tipos';
import styles from './FormularioDeVisualizacao.module.scss';

/**
 * "Já assistimos" (cineon-expansao §4.1 e §4.2): quando, onde e quem.
 *
 * Usado pelo "+" e, depois, pelo detalhe do filme — o detalhe de um filme em
 * cartaz abre este mesmo formulário já no cinema e com a data de hoje (§4.2).
 *
 * **A data tem precisão.** "Vimos em 2019" é resposta legítima para filme
 * antigo, e obrigar um dia faria a pessoa inventar um. O backend lê a precisão
 * pelo formato (`2026-11-14`, `2019-07`, `2019`), então aqui basta trocar o
 * tipo do campo.
 */

const SALAS_SUGERIDAS = ['Comum', 'IMAX', 'XD', 'VIP', 'D-BOX', '4DX', 'Dolby', '3D'];
const OUTRO_CINEMA = '__outro__';

function hojeLocal(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** O valor do campo, convertido quando a precisão muda — sem perder o que dá. */
function ajustarData(valor: string, precisao: PrecisaoDaData): string {
  const ano = valor.slice(0, 4) || String(new Date().getFullYear());
  const mes = valor.slice(5, 7) || '01';
  if (precisao === 'ANO') return ano;
  if (precisao === 'MES') return `${ano}-${mes}`;
  return valor.length === 10 ? valor : `${ano}-${mes}-01`;
}

export function FormularioDeVisualizacao({
  eu,
  inicial,
  enviando,
  erro,
  aoEnviar,
  aoCancelar,
}: {
  /** a pessoa logada: começa marcada em "quem estava" */
  eu: Pessoa;
  inicial?: Partial<DadosDaVisualizacao>;
  enviando: boolean;
  erro: string | null;
  aoEnviar: (dados: DadosDaVisualizacao) => void;
  aoCancelar: () => void;
}) {
  const perfis = useApi<{ itens: PerfilDoApp[] }>('/users');
  const cinemas = useApi<{ itens: CinemaDaLista[] }>('/cinemas');

  const [precisao, setPrecisao] = useState<PrecisaoDaData>('DIA');
  const [data, setData] = useState(inicial?.data ?? hojeLocal());
  const [local, setLocal] = useState<LocalDaVisualizacao>(inicial?.local ?? 'CASA');
  // "assistimos" é plural: começa com os dois, e quem viu sozinho desmarca o outro
  const [quem, setQuem] = useState<Pessoa[]>(inicial?.participantes ?? ['CAT', 'BEAR']);
  const [cinemaId, setCinemaId] = useState(inicial?.cinemaId ?? '');
  const [cinemaLivre, setCinemaLivre] = useState(inicial?.cinemaNomeLivre ?? '');
  const [sala, setSala] = useState(inicial?.tipoSala ?? '');
  const [observacao, setObservacao] = useState(inicial?.observacao ?? '');

  const hoje = hojeLocal();
  const ordemDasPessoas: Pessoa[] = eu === 'CAT' ? ['CAT', 'BEAR'] : ['BEAR', 'CAT'];

  const problema = useMemo(() => {
    if (quem.length === 0) return 'Marque quem assistiu.';
    if (!data) return 'Diga quando foi.';
    if (precisao === 'ANO' && !/^\d{4}$/.test(data)) return 'O ano tem 4 dígitos.';
    if (data > hoje.slice(0, data.length)) return 'A data está no futuro.';
    if (local === 'CINEMA' && cinemaId === OUTRO_CINEMA && !cinemaLivre.trim()) {
      return 'Escreva o nome do cinema, ou deixe em branco escolhendo "Não lembro".';
    }
    return null;
  }, [quem, data, precisao, hoje, local, cinemaId, cinemaLivre]);

  function trocarPrecisao(nova: PrecisaoDaData) {
    setPrecisao(nova);
    setData((atual) => ajustarData(atual, nova));
  }

  function alternar(pessoa: Pessoa) {
    setQuem((atual) => (atual.includes(pessoa) ? atual.filter((p) => p !== pessoa) : [...atual, pessoa]));
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (problema || enviando) return;

    const noCinema = local === 'CINEMA';
    aoEnviar({
      data,
      local,
      participantes: quem,
      cinemaId: noCinema && cinemaId && cinemaId !== OUTRO_CINEMA ? cinemaId : null,
      cinemaNomeLivre: noCinema && cinemaId === OUTRO_CINEMA ? cinemaLivre.trim() : null,
      tipoSala: noCinema && sala.trim() ? sala.trim() : null,
      observacao: observacao.trim() || null,
    });
  }

  return (
    <form className={styles.formulario} onSubmit={enviar} noValidate>
      <fieldset className={styles.grupo}>
        <legend className={styles.rotulo}>Quando</legend>

        <div className={styles.segmentos} role="group" aria-label="Precisão da data">
          {(
            [
              ['DIA', 'Dia'],
              ['MES', 'Mês'],
              ['ANO', 'Só o ano'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={precisao === valor ? `${styles.segmento} ${styles.ativo}` : styles.segmento}
              aria-pressed={precisao === valor}
              onClick={() => trocarPrecisao(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {precisao === 'DIA' ? (
          <input
            className={styles.campo}
            type="date"
            value={data}
            max={hoje}
            onChange={(e) => setData(e.target.value)}
            aria-label="Data"
          />
        ) : precisao === 'MES' ? (
          <input
            className={styles.campo}
            type="month"
            value={data}
            max={hoje.slice(0, 7)}
            onChange={(e) => setData(e.target.value)}
            aria-label="Mês"
          />
        ) : (
          <input
            className={styles.campo}
            type="number"
            inputMode="numeric"
            min={1900}
            max={Number(hoje.slice(0, 4))}
            value={data}
            onChange={(e) => setData(e.target.value.slice(0, 4))}
            aria-label="Ano"
          />
        )}
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.rotulo}>Onde</legend>
        <div className={styles.segmentos} role="group" aria-label="Onde assistiram">
          {(
            [
              ['CASA', '🏠 Em casa'],
              ['CINEMA', '🎬 No cinema'],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              className={local === valor ? `${styles.segmento} ${styles.ativo}` : styles.segmento}
              aria-pressed={local === valor}
              onClick={() => setLocal(valor)}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {local === 'CINEMA' ? (
          <div className={styles.cinema}>
            <select
              className={styles.campo}
              value={cinemaId}
              onChange={(e) => setCinemaId(e.target.value)}
              aria-label="Cinema"
            >
              <option value="">Não lembro o cinema</option>
              {cinemas.dados?.itens.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
              <option value={OUTRO_CINEMA}>Outro cinema…</option>
            </select>

            {cinemaId === OUTRO_CINEMA ? (
              <input
                className={styles.campo}
                value={cinemaLivre}
                onChange={(e) => setCinemaLivre(e.target.value)}
                placeholder="Nome do cinema"
                maxLength={120}
                aria-label="Nome do cinema"
              />
            ) : null}

            <input
              className={styles.campo}
              value={sala}
              onChange={(e) => setSala(e.target.value)}
              placeholder="Sala (opcional): IMAX, VIP…"
              list="salas-sugeridas"
              maxLength={40}
              aria-label="Tipo de sala"
            />
            <datalist id="salas-sugeridas">
              {SALAS_SUGERIDAS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        ) : null}
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.rotulo}>Quem estava</legend>
        <div className={styles.pessoas}>
          {ordemDasPessoas.map((pessoa) => {
            const perfil = perfis.dados ? perfilDaPessoa(perfis.dados.itens, pessoa) : undefined;
            const marcada = quem.includes(pessoa);
            return (
              <button
                key={pessoa}
                type="button"
                className={marcada ? `${styles.pessoa} ${styles.pessoaMarcada}` : styles.pessoa}
                aria-pressed={marcada}
                onClick={() => alternar(pessoa)}
                style={marcada && perfil ? { borderColor: perfil.acento } : undefined}
              >
                <span
                  className={styles.inicial}
                  style={perfil ? { background: perfil.acento } : undefined}
                  aria-hidden="true"
                >
                  {perfil?.inicial ?? (pessoa === 'CAT' ? 'C' : 'H')}
                </span>
                {perfil?.nome ?? pessoa}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.rotulo}>Observação</legend>
        <textarea
          className={`${styles.campo} ${styles.texto}`}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
          maxLength={1000}
          rows={2}
        />
      </fieldset>

      {erro || problema ? (
        <p className={styles.problema} role={erro ? 'alert' : undefined}>
          {erro ?? problema}
        </p>
      ) : null}

      <div className={styles.acoes}>
        <button type="submit" className={styles.primario} disabled={Boolean(problema) || enviando}>
          {enviando ? 'Registrando…' : 'Registrar que assistimos'}
        </button>
        <button type="button" className={styles.secundario} onClick={aoCancelar} disabled={enviando}>
          Voltar
        </button>
      </div>
    </form>
  );
}
