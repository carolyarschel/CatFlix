import { useMemo, useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { IconeIngresso } from '../../shared/components/Icones';
import { formatarDia } from '../../shared/dias';
import { useApi } from '../../shared/hooks/useApi';
import { useNotificacoes } from '../../shared/hooks/useNotificacoes';
import type { IngressoComprado, SessaoDoDia, SessoesPorCinema } from '../../shared/api/tipos';
import styles from './IngressosComprados.module.scss';

/**
 * Ingresso comprado (pedido de 20/11/2026): a sessão escolhida na grade do
 * ingresso.com e os códigos de resgate. 30 minutos antes da sessão, os
 * aparelhos das duas contas recebem um push com os códigos — quem manda é o
 * backend (`tickets.lembrete.ts`), não esta tela.
 *
 * É do casal: os dois veem e editam o mesmo ingresso.
 */

const MAXIMO_DE_CODIGOS = 10;

export function IngressosComprados({
  titleId,
  sessoes,
  aoNavegar,
  aoMarcarAssistido,
}: {
  titleId: string;
  sessoes: SessoesPorCinema[];
  aoNavegar: (para: string) => void;
  /** a visualização foi registrada: o detalhe recarrega para mostrá-la */
  aoMarcarAssistido: () => void;
}) {
  const ingressos = useApi<{ itens: IngressoComprado[] }>(`/titles/${titleId}/tickets`);
  const notificacoes = useNotificacoes();

  /** `null`: fechado; `'novo'`: cadastrando; id: editando aquele */
  const [formulario, setFormulario] = useState<string | null>(null);

  const itens = ingressos.dados?.itens ?? [];
  const temSessaoFutura = sessoes.some((c) => c.sessoes.length > 0);
  const editando = itens.find((i) => i.id === formulario) ?? null;

  // sem ingresso e sem sessão para escolher, o bloco não tem o que dizer
  if (itens.length === 0 && !temSessaoFutura) return null;

  async function remover(ingresso: IngressoComprado) {
    if (!window.confirm(`Remover o ingresso de ${formatarDia(ingresso.dia)} às ${ingresso.horario}?`)) return;
    try {
      await api.delete(`/tickets/${ingresso.id}`);
      ingressos.recarregar();
    } catch (problema) {
      window.alert(problema instanceof ApiError ? problema.message : 'Não consegui remover o ingresso.');
    }
  }

  // só quando a pessoa pode resolver: ligar, desbloquear ou instalar o app
  async function marcarAssistido(ingresso: IngressoComprado) {
    const comecou = new Date(ingresso.inicio).getTime() <= Date.now();
    const pergunta = comecou
      ? 'Marcar como assistido pelos dois, no cinema, na data do ingresso?'
      : 'A sessão ainda não começou. Marcar como assistido mesmo assim?';
    if (!window.confirm(pergunta)) return;
    try {
      await api.post(`/tickets/${ingresso.id}/assistido`, {});
      ingressos.recarregar();
      aoMarcarAssistido();
    } catch (problema) {
      window.alert(problema instanceof ApiError ? problema.message : 'Não consegui marcar como assistido.');
    }
  }

  const avisoDeNotificacao =
    itens.length > 0 && ['desligado', 'bloqueado', 'precisa_instalar'].includes(notificacoes.estado);

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>Ingresso comprado</h2>

      {ingressos.erro ? (
        <p className={styles.erro} role="alert">
          {ingressos.erro}{' '}
          <button type="button" className={styles.link} onClick={ingressos.recarregar}>
            Tentar de novo
          </button>
        </p>
      ) : null}

      {itens.map((ingresso) =>
        formulario === ingresso.id ? null : (
          <CartaoDoIngresso
            key={ingresso.id}
            ingresso={ingresso}
            aoEditar={() => setFormulario(ingresso.id)}
            aoRemover={() => void remover(ingresso)}
            aoMarcarAssistido={() => void marcarAssistido(ingresso)}
          />
        ),
      )}

      {avisoDeNotificacao ? (
        <p className={styles.dica}>
          As notificações estão desligadas neste aparelho, então o lembrete com os códigos não chega aqui.{' '}
          <button type="button" className={styles.link} onClick={() => aoNavegar('/perfil')}>
            Ativar no perfil
          </button>
        </p>
      ) : null}

      {formulario ? (
        <FormularioDeIngresso
          titleId={titleId}
          sessoes={sessoes}
          ocupadas={new Set(itens.filter((i) => i.id !== editando?.id && i.sessaoId).map((i) => i.sessaoId!))}
          ingresso={editando}
          aoSalvar={() => {
            setFormulario(null);
            ingressos.recarregar();
          }}
          aoCancelar={() => setFormulario(null)}
        />
      ) : temSessaoFutura ? (
        <button type="button" className={styles.comprado} onClick={() => setFormulario('novo')}>
          <IconeIngresso tamanho={19} />
          {itens.length > 0 ? 'Outro ingresso comprado' : 'Ingresso comprado'}
        </button>
      ) : null}
    </section>
  );
}

function CartaoDoIngresso({
  ingresso,
  aoEditar,
  aoRemover,
  aoMarcarAssistido,
}: {
  ingresso: IngressoComprado;
  aoEditar: () => void;
  aoRemover: () => void;
  aoMarcarAssistido: () => void;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(codigo);
      window.setTimeout(() => setCopiado((atual) => (atual === codigo ? null : atual)), 1800);
    } catch {
      // sem permissão de área de transferência: o código está à vista para copiar à mão
    }
  }

  const comecou = new Date(ingresso.inicio).getTime() <= Date.now();

  return (
    <article className={styles.cartao}>
      <div className={styles.quando}>
        <IconeIngresso tamanho={20} />
        <span className={styles.dia}>{formatarDia(ingresso.dia)}</span>
        <span className={styles.hora}>{ingresso.horario}</span>
      </div>
      <p className={styles.onde}>
        {ingresso.cinema}
        {ingresso.detalhes ? <span className={styles.detalhes}> · {ingresso.detalhes}</span> : null}
      </p>

      {ingresso.codigos.length > 0 ? (
        <ul className={styles.codigos} aria-label="Códigos de resgate">
          {ingresso.codigos.map((codigo) => (
            <li key={codigo} className={styles.codigo}>
              <code className={styles.textoDoCodigo}>{codigo}</code>
              <button
                type="button"
                className={styles.copiar}
                onClick={() => void copiar(codigo)}
                aria-label={`Copiar o código ${codigo}`}
              >
                {copiado === codigo ? 'Copiado' : 'Copiar'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.semCodigo}>Nenhum código de resgate cadastrado.</p>
      )}

      {comecou ? (
        <button type="button" className={styles.assistido} onClick={aoMarcarAssistido}>
          Marcar como assistido
        </button>
      ) : null}

      <div className={styles.rodape}>
        <span className={styles.lembrete}>
          {comecou
            ? 'A sessão já começou'
            : ingresso.lembreteEnviadoEm
              ? 'Lembrete enviado'
              : 'Vamos avisar 30 min antes'}
        </span>
        <span className={styles.acoes}>
          <button type="button" className={styles.link} onClick={aoEditar}>
            Editar
          </button>
          <button type="button" className={styles.linkDiscreto} onClick={aoRemover}>
            Remover
          </button>
        </span>
      </div>
    </article>
  );
}

function FormularioDeIngresso({
  titleId,
  sessoes,
  ocupadas,
  ingresso,
  aoSalvar,
  aoCancelar,
}: {
  titleId: string;
  sessoes: SessoesPorCinema[];
  /** sessões que já têm outro ingresso: um por sessão */
  ocupadas: Set<string>;
  /** `null`: cadastrando um novo */
  ingresso: IngressoComprado | null;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const cinemas = sessoes.filter((c) => c.sessoes.length > 0);

  // ao editar, começa na sessão do ingresso (se ela ainda está na grade)
  const inicial = useMemo(() => {
    for (const c of cinemas) {
      const s = c.sessoes.find((x) => x.id === ingresso?.sessaoId);
      if (s) return { cinemaId: c.cinemaId, dia: s.dia, sessaoId: s.id };
    }
    const primeiro = cinemas[0];
    return { cinemaId: primeiro?.cinemaId ?? '', dia: primeiro?.sessoes[0]?.dia ?? '', sessaoId: null };
    // só na abertura do formulário
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cinemaId, setCinemaId] = useState(inicial.cinemaId);
  const [dia, setDia] = useState(inicial.dia);
  const [sessaoId, setSessaoId] = useState<string | null>(inicial.sessaoId);
  const [codigos, setCodigos] = useState<string[]>(ingresso?.codigos.length ? ingresso.codigos : ['']);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cinema = cinemas.find((c) => c.cinemaId === cinemaId) ?? cinemas[0];
  const dias = useMemo(() => [...new Set(cinema?.sessoes.map((s) => s.dia) ?? [])], [cinema]);
  const horarios = cinema?.sessoes.filter((s) => s.dia === dia) ?? [];

  // editando um ingresso cuja sessão sumiu da grade: dá para trocar só os códigos
  const sessaoAntigaForaDaGrade = ingresso !== null && inicial.sessaoId === null;

  function escolherCinema(id: string) {
    setCinemaId(id);
    const c = cinemas.find((x) => x.cinemaId === id);
    setDia(c?.sessoes[0]?.dia ?? '');
    setSessaoId(null);
  }

  function escolherDia(novo: string) {
    setDia(novo);
    setSessaoId(null);
  }

  async function salvar() {
    if (!sessaoId && !sessaoAntigaForaDaGrade) {
      setErro('Escolha a sessão.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const corpoCodigos = codigos.map((c) => c.trim()).filter(Boolean);
      if (ingresso) {
        await api.patch(`/tickets/${ingresso.id}`, {
          codigos: corpoCodigos,
          ...(sessaoId && sessaoId !== ingresso.sessaoId ? { sessaoId } : {}),
        });
      } else {
        await api.post(`/titles/${titleId}/tickets`, { sessaoId, codigos: corpoCodigos });
      }
      aoSalvar();
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui salvar o ingresso.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      className={styles.formulario}
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      {sessaoAntigaForaDaGrade && ingresso ? (
        <p className={styles.dica}>
          A sessão de {formatarDia(ingresso.dia)} às {ingresso.horario} saiu da grade do ingresso.com. Escolha
          outra só se quiser trocar.
        </p>
      ) : null}

      {cinemas.length > 1 ? (
        <fieldset className={styles.grupo}>
          <legend className={styles.legenda}>Cinema</legend>
          <div className={styles.opcoes}>
            {cinemas.map((c) => (
              <Opcao key={c.cinemaId} ativa={c.cinemaId === cinema?.cinemaId} onClick={() => escolherCinema(c.cinemaId)}>
                {c.cinema}
              </Opcao>
            ))}
          </div>
        </fieldset>
      ) : cinema ? (
        <p className={styles.cinemaUnico}>{cinema.cinema}</p>
      ) : null}

      {dias.length > 0 ? (
        <fieldset className={styles.grupo}>
          <legend className={styles.legenda}>Dia</legend>
          <div className={styles.opcoesRolando}>
            {dias.map((d) => (
              <Opcao key={d} ativa={d === dia} onClick={() => escolherDia(d)}>
                {formatarDia(d)}
              </Opcao>
            ))}
          </div>
        </fieldset>
      ) : null}

      {horarios.length > 0 ? (
        <fieldset className={styles.grupo}>
          <legend className={styles.legenda}>Horário</legend>
          <div className={styles.opcoes}>
            {horarios.map((s) => (
              <Horario
                key={s.id}
                sessao={s}
                ativa={s.id === sessaoId}
                ocupada={ocupadas.has(s.id)}
                onClick={() => setSessaoId(s.id)}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className={styles.grupo}>
        <legend className={styles.legenda}>Códigos de resgate</legend>
        {codigos.map((codigo, i) => (
          <div key={i} className={styles.linhaDoCodigo}>
            <input
              className={styles.campo}
              value={codigo}
              onChange={(e) => setCodigos((atuais) => atuais.map((c, j) => (j === i ? e.target.value : c)))}
              placeholder={i === 0 ? 'Ex.: 8F3K2Q' : 'Outro código'}
              aria-label={`Código de resgate ${i + 1}`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={120}
            />
            {codigos.length > 1 ? (
              <button
                type="button"
                className={styles.tirar}
                onClick={() => setCodigos((atuais) => atuais.filter((_, j) => j !== i))}
                aria-label={`Tirar o código ${i + 1}`}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        {codigos.length < MAXIMO_DE_CODIGOS ? (
          <button type="button" className={styles.link} onClick={() => setCodigos((atuais) => [...atuais, ''])}>
            + Outro código
          </button>
        ) : null}
      </fieldset>

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      <div className={styles.botoes}>
        <button type="submit" className={styles.salvar} disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar ingresso'}
        </button>
        <button type="button" className={styles.cancelar} disabled={enviando} onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Opcao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={ativa ? `${styles.opcao} ${styles.opcaoAtiva}` : styles.opcao}
      aria-pressed={ativa}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Horario({
  sessao,
  ativa,
  ocupada,
  onClick,
}: {
  sessao: SessaoDoDia;
  ativa: boolean;
  ocupada: boolean;
  onClick: () => void;
}) {
  const detalhes = ocupada
    ? 'já cadastrado'
    : [sessao.sala, sessao.is3d ? '3D' : null, sessao.audioRotulo].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={ativa ? `${styles.horario} ${styles.opcaoAtiva}` : styles.horario}
      aria-pressed={ativa}
      disabled={ocupada}
      onClick={onClick}
    >
      <span className={styles.horaDoHorario}>{sessao.horario}</span>
      {detalhes ? <span className={styles.detalhesDoHorario}>{detalhes}</span> : null}
    </button>
  );
}
