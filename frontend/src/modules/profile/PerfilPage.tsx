import { IconeVoltar } from '../../shared/components/Icones';
import { useApi } from '../../shared/hooks/useApi';
import { useInstalacao } from '../../shared/hooks/useInstalacao';
import { useNotificacoes } from '../../shared/hooks/useNotificacoes';
import { useSessao } from '../../shared/hooks/useSessao';
import type { PerfilDoApp } from '../../shared/api/tipos';
import styles from './PerfilPage.module.scss';

/**
 * Tela de perfil — último item do passo 10.
 *
 * Três coisas: quem está usando o app, **as notificações** e o estado do sync.
 *
 * O meio é o que justifica a tela existir. O §3 escolheu o Web Push do próprio
 * PWA como canal dos canaries e registrou a restrição que decide o layout: no
 * iOS o Safari só entrega push com o app **instalado na tela de início**.
 * Aberto pelo navegador, não chega nada — e nem dá erro. A Carol usa iPhone e é
 * quem mais acompanha a fila de revisão, então o passo a passo do "Adicionar à
 * Tela de Início" é **obrigatório**, não um extra.
 */

interface SaudeDoSync {
  status: 'ok' | 'degradado' | 'critico';
  degradado: { ativo: boolean; idadeDosDadosEmHoras: number | null; aviso: string | null };
  execucoes: Array<{ job: string; status: string; inicio: string; fim: string | null }>;
  canaries: Array<{ camada: string; alvo: string; passou: boolean }>;
  alertas?: unknown[];
}

const STATUS: Record<string, string> = {
  ok: 'Tudo certo',
  degradado: 'Atenção',
  critico: 'Crítico',
};

export function PerfilPage({ perfil, aoVoltar }: { perfil: PerfilDoApp; aoVoltar: () => void }) {
  const { sair } = useSessao();
  const notificacoes = useNotificacoes();
  const instalacao = useInstalacao();
  const saude = useApi<SaudeDoSync>('/health/sync');

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
          <IconeVoltar />
        </button>
        <h1 className={styles.titulo}>Perfil</h1>
      </header>

      <section className={styles.identidade}>
        <span className={styles.inicial} style={{ background: perfil.acento }}>
          {perfil.inicial}
        </span>
        <div>
          <p className={styles.nome}>{perfil.nome}</p>
          <p className={styles.detalhe}>Sessão aberta neste aparelho</p>
        </div>
      </section>

      <Instalacao instalacao={instalacao} ehIOS={notificacoes.ehIOS} />

      <Notificacoes notificacoes={notificacoes} />

      <section className={styles.bloco}>
        <h2 className={styles.rotulo}>Estado do sync</h2>

        {saude.carregando && !saude.dados ? (
          <p className={styles.apoio}>Consultando…</p>
        ) : saude.erro || !saude.dados ? (
          <p className={styles.apoio} role="alert">
            {saude.erro ?? 'Não consegui consultar o sync.'}
          </p>
        ) : (
          <div className={styles.saude}>
            <p
              className={
                saude.dados.status === 'ok'
                  ? `${styles.selo} ${styles.seloOk}`
                  : `${styles.selo} ${styles.seloAtencao}`
              }
            >
              {STATUS[saude.dados.status] ?? saude.dados.status}
            </p>

            {saude.dados.degradado.aviso ? (
              <p className={styles.apoio}>Modo degradado: {saude.dados.degradado.aviso}.</p>
            ) : (
              <p className={styles.apoio}>
                {saude.dados.degradado.idadeDosDadosEmHoras === null
                  ? 'Nenhum dado sincronizado ainda.'
                  : `Dado mais novo: ${formatarIdade(saude.dados.degradado.idadeDosDadosEmHoras)}.`}
              </p>
            )}

            <ul className={styles.execucoes}>
              {saude.dados.execucoes.slice(0, 4).map((execucao) => (
                <li key={`${execucao.job}-${execucao.inicio}`} className={styles.execucao}>
                  <span className={styles.job}>{execucao.job}</span>
                  <span
                    className={
                      execucao.status === 'success'
                        ? styles.resultadoOk
                        : styles.resultadoFalhou
                    }
                  >
                    {execucao.status === 'success' ? 'ok' : execucao.status}
                  </span>
                  <span className={styles.quando}>{formatarQuando(execucao.inicio)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className={styles.rodape}>
        <button type="button" className={styles.sair} onClick={() => void sair()}>
          Sair
        </button>
        <p className={styles.apoio}>
          Sair leva de volta ao login, onde dá para entrar com o outro perfil.
        </p>
      </div>
    </div>
  );
}

/**
 * Instalar o app na tela de início.
 *
 * Os dois caminhos são diferentes o suficiente para não caberem num texto só:
 * no Android o navegador oferece o convite e um toque resolve; no iPhone não há
 * convite nenhum, só o passo a passo manual — que vive no bloco de
 * notificações, porque lá ele é pré-requisito para receber alerta.
 *
 * Instalado, este bloco some: já não há o que pedir.
 */
function Instalacao({
  instalacao,
  ehIOS,
}: {
  instalacao: ReturnType<typeof useInstalacao>;
  ehIOS: boolean;
}) {
  if (instalacao.instalado) {
    return (
      <section className={styles.bloco}>
        <h2 className={styles.rotulo}>App</h2>
        <p className={`${styles.selo} ${styles.seloOk}`}>Instalado neste aparelho</p>
      </section>
    );
  }

  // no iPhone o convite nunca chega; quem ensina a instalar é o bloco de
  // notificações, e repetir aqui só duplicaria a mesma instrução
  if (!instalacao.disponivel) {
    return ehIOS ? null : (
      <section className={styles.bloco}>
        <h2 className={styles.rotulo}>App</h2>
        <p className={styles.apoio}>
          Dá para instalar o app na tela de início pelo menu do navegador. Instalado, ele abre sem
          a barra de endereço e recebe as notificações.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>App</h2>
      <p className={styles.apoio}>
        Instalado, ele abre sem a barra de endereço, aparece junto dos outros apps e recebe as
        notificações.
      </p>
      <button type="button" className={styles.primario} onClick={() => void instalacao.instalar()}>
        Instalar na tela de início
      </button>
    </section>
  );
}

function Notificacoes({ notificacoes }: { notificacoes: ReturnType<typeof useNotificacoes> }) {
  const { estado, ehIOS, dispositivos, erro, ativar, desativar } = notificacoes;

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>Notificações</h2>
      <p className={styles.apoio}>
        Avisam quando o sync quebra ou a fila de revisão cresce — é o canal dos canaries.
      </p>

      {estado === 'carregando' ? <p className={styles.apoio}>Verificando…</p> : null}

      {/* O caso da Carol. Não é aviso: é a única forma de ela receber alerta. */}
      {estado === 'precisa_instalar' ? <PassoAPassoDoIOS /> : null}

      {estado === 'sem_suporte' ? (
        <p className={styles.apoio}>
          Este navegador não faz notificação por push. No celular, instale o app na tela de início.
        </p>
      ) : null}

      {estado === 'sem_chave' ? (
        <p className={styles.apoio}>
          O servidor está sem as chaves VAPID, então nenhuma notificação sai daqui. Defina
          <code className={styles.codigo}>VAPID_PUBLIC_KEY</code> e
          <code className={styles.codigo}>VAPID_PRIVATE_KEY</code> no <code className={styles.codigo}>.env</code> do backend.
        </p>
      ) : null}

      {estado === 'bloqueado' ? (
        <p className={styles.apoio}>
          As notificações estão bloqueadas nas configurações deste navegador. Só dá para reverter
          por lá — o app não consegue perguntar de novo.
        </p>
      ) : null}

      {estado === 'desligado' || estado === 'ligando' ? (
        <>
          <button
            type="button"
            className={styles.primario}
            onClick={() => void ativar()}
            disabled={estado === 'ligando'}
          >
            {estado === 'ligando' ? 'Ligando…' : 'Ligar notificações neste aparelho'}
          </button>
          {/* iOS instalado funciona, mas é bom dizer que vale só para este aparelho */}
          {ehIOS ? (
            <p className={styles.apoio}>
              Vale só para este aparelho: cada celular precisa ligar o seu.
            </p>
          ) : null}
        </>
      ) : null}

      {estado === 'ligado' ? (
        <>
          <p className={`${styles.selo} ${styles.seloOk}`}>Ligadas neste aparelho</p>
          <button type="button" className={styles.secundario} onClick={() => void desativar()}>
            Desligar
          </button>
        </>
      ) : null}

      {dispositivos !== null && estado !== 'carregando' ? (
        <p className={styles.apoio}>
          {dispositivos === 0
            ? 'Nenhum aparelho inscrito — hoje os alertas só vão para o log do servidor.'
            : dispositivos === 1
              ? '1 aparelho inscrito.'
              : `${dispositivos} aparelhos inscritos.`}
        </p>
      ) : null}

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </section>
  );
}

/**
 * O passo a passo que o §3 marca como obrigatório.
 *
 * Escrito com os nomes que aparecem no iPhone, e não "use o menu de
 * compartilhamento": o botão não tem rótulo em texto na tela, então descrever o
 * ícone é o que faz a pessoa achar.
 */
function PassoAPassoDoIOS() {
  return (
    <div className={styles.instalacao}>
      <p className={styles.instalacaoTitulo}>
        No iPhone, as notificações só funcionam com o app instalado.
      </p>
      <p className={styles.apoio}>
        É restrição do Safari, não do app: aberto pelo navegador, nenhum alerta chega — nem com
        permissão concedida.
      </p>

      <ol className={styles.passos}>
        <li>
          Toque no botão <strong>Compartilhar</strong> — o quadrado com a seta para cima, na barra
          de baixo do Safari.
        </li>
        <li>
          Role a lista e escolha <strong>Adicionar à Tela de Início</strong>.
        </li>
        <li>
          Toque em <strong>Adicionar</strong>, no canto superior direito.
        </li>
        <li>Abra o app pelo ícone novo e volte aqui para ligar as notificações.</li>
      </ol>
    </div>
  );
}

function formatarIdade(horas: number): string {
  if (horas < 1) return 'menos de uma hora atrás';
  if (horas < 24) {
    const inteiras = Math.round(horas);
    return inteiras === 1 ? '1 hora atrás' : `${inteiras} horas atrás`;
  }
  const dias = Math.round(horas / 24);
  return dias === 1 ? '1 dia atrás' : `${dias} dias atrás`;
}

function formatarQuando(iso: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '—';

  const minutos = Math.round((Date.now() - quando.getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas}h`;
  return quando.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}
