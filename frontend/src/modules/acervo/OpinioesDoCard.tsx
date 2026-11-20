import { SeloDePessoa } from '../../shared/components/SeloDePessoa';
import { formatarNota } from '../../shared/notas';
import { PERFIL_DA_PESSOA, perfilDaPessoa } from '../../shared/pessoas';
import type { OpiniaoDaPessoa, PerfilDoApp } from '../../shared/api/tipos';
import styles from './OpinioesDoCard.module.scss';

/**
 * A nota e o comentário de cada um no card da aba "Assistidos" (pedido de
 * 19/11/2026; layout de 20/11/2026). As notas vão na linha de cima do rodapé,
 * no lugar das notas do IMDb/RT; os comentários, uma linha cada, embaixo.
 * Só aparece o que existe — e quem chama só passa o componente quando há
 * alguma coisa, para o card cair no conteúdo padrão quando não há.
 * O comentário inteiro está no detalhe do filme.
 */

function quem(perfis: PerfilDoApp[], o: OpiniaoDaPessoa) {
  const perfil = perfilDaPessoa(perfis, o.pessoa);
  return {
    nome: perfil?.nome ?? (o.pessoa === 'CAT' ? 'CatFlix' : 'HBUrso'),
    acento: perfil?.acento ?? '#A79FB5',
  };
}

export function temNotas(opinioes: OpiniaoDaPessoa[]): boolean {
  return opinioes.some((o) => o.nota !== null);
}

export function temComentarios(opinioes: OpiniaoDaPessoa[]): boolean {
  return opinioes.some((o) => Boolean(o.comentario));
}

export function NotasDoCard({ opinioes, perfis }: { opinioes: OpiniaoDaPessoa[]; perfis: PerfilDoApp[] }) {
  return (
    <span className={styles.notas}>
      {opinioes
        .filter((o) => o.nota !== null)
        .map((o) => {
          const { nome, acento } = quem(perfis, o);
          return (
            <span key={o.pessoa} className={styles.nota}>
              <SeloDePessoa perfilId={PERFIL_DA_PESSOA[o.pessoa]} acento={acento} tamanho={18} />
              <span className={styles.oculto}>Nota de {nome}:</span>
              {formatarNota(o.nota!)}
            </span>
          );
        })}
    </span>
  );
}

export function ComentariosDoCard({ opinioes, perfis }: { opinioes: OpiniaoDaPessoa[]; perfis: PerfilDoApp[] }) {
  return (
    <ul className={styles.comentarios}>
      {opinioes
        .filter((o) => o.comentario)
        .map((o) => {
          const { nome, acento } = quem(perfis, o);
          return (
            <li key={o.pessoa} className={styles.comentario}>
              <SeloDePessoa perfilId={PERFIL_DA_PESSOA[o.pessoa]} acento={acento} tamanho={16} />
              <span className={styles.oculto}>{nome} comentou:</span>
              <span className={styles.texto}>{o.comentario}</span>
            </li>
          );
        })}
    </ul>
  );
}
