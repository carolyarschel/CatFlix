import { IconeGato, IconeUrso } from './Icones';
import styles from './SeloDePessoa.module.scss';

/**
 * O selo de uma pessoa: o rosto do gato (CatFlix) ou do urso (HBUrso) num
 * círculo escuro, no acento do perfil. Substitui o círculo com a inicial
 * (decisão de 18/11/2026).
 *
 * As duas pessoas juntas aparecem como dois selos lado a lado — o §7 da
 * expansão proíbe uma terceira cor para "os dois".
 */
export function SeloDePessoa({
  perfilId,
  acento,
  tamanho = 22,
  rotulo,
}: {
  /** `catflix` ou `hburso` */
  perfilId: string;
  acento: string;
  /** diâmetro do círculo, em px */
  tamanho?: number;
  /** texto para leitor de tela e dica ao passar o mouse */
  rotulo?: string;
}) {
  const Icone = perfilId === 'hburso' ? IconeUrso : IconeGato;
  // o rosto ocupa ~70% do círculo; abaixo de 24 px o traço engrossa para não sumir
  const icone = Math.round(tamanho * 0.7);

  return (
    <span
      className={styles.selo}
      style={{ width: tamanho, height: tamanho, color: acento }}
      title={rotulo}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    >
      <Icone tamanho={icone} traco={tamanho < 24 ? 2.4 : 2} />
    </span>
  );
}
