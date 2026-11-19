import { SeloDePessoa } from '../../shared/components/SeloDePessoa';
import { formatarNota } from '../../shared/notas';
import { PERFIL_DA_PESSOA, perfilDaPessoa } from '../../shared/pessoas';
import type { OpiniaoDaPessoa, PerfilDoApp } from '../../shared/api/tipos';
import styles from './OpinioesDoCard.module.scss';

/**
 * A nota e o comentário de cada um, embaixo do pôster na aba "Assistidos"
 * (pedido de 19/11/2026). Só aparece o que existe: sem nota, sem número; sem
 * comentário, sem texto. O comentário é cortado em poucas linhas — inteiro,
 * ele está no detalhe do filme.
 */
export function OpinioesDoCard({ opinioes, perfis }: { opinioes: OpiniaoDaPessoa[]; perfis: PerfilDoApp[] }) {
  if (opinioes.length === 0) return null;

  return (
    <ul className={styles.opinioes}>
      {opinioes.map((o) => {
        const perfil = perfilDaPessoa(perfis, o.pessoa);
        const nome = perfil?.nome ?? (o.pessoa === 'CAT' ? 'CatFlix' : 'HBUrso');
        return (
          <li key={o.pessoa} className={styles.opiniao}>
            <span className={styles.cabeca}>
              <SeloDePessoa perfilId={PERFIL_DA_PESSOA[o.pessoa]} acento={perfil?.acento ?? '#A79FB5'} tamanho={18} />
              <span className={styles.quem}>{nome}</span>
              {o.nota !== null ? (
                <span className={styles.nota} aria-label={`nota ${formatarNota(o.nota)}`}>
                  {formatarNota(o.nota)}
                </span>
              ) : null}
            </span>
            {o.comentario ? <span className={styles.comentario}>{o.comentario}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
