import type { ContagemDaRevisao } from '../api/tipos';
import { useApi } from '../hooks/useApi';
import { Badge } from './Badge';
import { IconeIngresso, IconeMaisOpcoes, IconeMarcador, IconeOlho } from './Icones';
import styles from './BottomNav.module.scss';

/**
 * Barra flutuante em pílula (§12), com as quatro abas do acervo do casal
 * (cineon-expansao §8): Cinema, Assistidos, Quero assistir e Mais.
 *
 * Antes ela rolava a home até as seções; desde a expansão, cada item é uma
 * tela. No desktop continua a mesma pílula: o desktop segue o mobile (§3,
 * decisão de 23/09/2026).
 *
 * **Revisar mora em "Mais"** (§8), e a pendência aparece como badge na aba —
 * sem pendência, nada (§2). A contagem é pedida aqui mesmo, para toda tela que
 * mostra a barra mostrar o mesmo número.
 */

export type AbaPrincipal = 'cinema' | 'assistidos' | 'quero-assistir' | 'mais';

const ABAS: Array<{ id: AbaPrincipal; rotulo: string; caminho: string }> = [
  { id: 'cinema', rotulo: 'Cinema', caminho: '/' },
  { id: 'assistidos', rotulo: 'Assistidos', caminho: '/assistidos' },
  { id: 'quero-assistir', rotulo: 'Quero assistir', caminho: '/quero-assistir' },
  { id: 'mais', rotulo: 'Mais', caminho: '/mais' },
];

function Icone({ aba }: { aba: AbaPrincipal }) {
  if (aba === 'cinema') return <IconeIngresso tamanho={21} />;
  if (aba === 'assistidos') return <IconeOlho tamanho={21} />;
  if (aba === 'quero-assistir') return <IconeMarcador tamanho={21} />;
  return <IconeMaisOpcoes tamanho={21} />;
}

export function BottomNav({
  ativa,
  aoNavegar,
  aoTocarNaAtiva,
}: {
  ativa: AbaPrincipal;
  aoNavegar: (para: string) => void;
  /** tocar na aba em que já se está: a home usa para voltar ao topo */
  aoTocarNaAtiva?: () => void;
}) {
  const revisao = useApi<ContagemDaRevisao>('/review/count');
  const pendencias = revisao.dados?.total ?? 0;

  return (
    <nav className={styles.barra} aria-label="Navegação principal">
      {ABAS.map((aba) => {
        const atual = aba.id === ativa;
        return (
          <button
            key={aba.id}
            type="button"
            className={atual ? `${styles.item} ${styles.ativo}` : styles.item}
            aria-current={atual ? 'page' : undefined}
            aria-label={
              aba.id === 'mais' && pendencias > 0 ? `Mais — ${pendencias} pendências na revisão` : undefined
            }
            onClick={() => (atual ? aoTocarNaAtiva?.() : aoNavegar(aba.caminho))}
          >
            <span className={styles.icone}>
              <Icone aba={aba.id} />
              {aba.id === 'mais' ? <Badge valor={pendencias} /> : null}
            </span>
            {aba.rotulo}
          </button>
        );
      })}
    </nav>
  );
}
