import type { PerfilDoApp } from '../api/tipos';
import { IconeCalendario, IconeInicio, IconeMarcador } from './Icones';
import styles from './BottomNav.module.scss';

/**
 * Barra flutuante em pílula do mobile (§12).
 *
 * "Revisar" NÃO mora aqui: no mobile ele é o ícone com badge do cabeçalho, e
 * some quando a fila está vazia (§2). Aqui ficam só os quatro destinos fixos.
 */
export function BottomNav({
  perfil,
  ativo,
  aoIrPara,
  aoAbrirPerfil,
}: {
  perfil: PerfilDoApp;
  ativo: string;
  aoIrPara: (destino: string) => void;
  aoAbrirPerfil: () => void;
}) {
  const itens = [
    { id: 'inicio', rotulo: 'Início', icone: <IconeInicio tamanho={21} /> },
    { id: 'em-breve', rotulo: 'Em breve', icone: <IconeCalendario tamanho={21} /> },
    { id: 'marcados', rotulo: 'Marcados', icone: <IconeMarcador tamanho={21} /> },
  ];

  return (
    <nav className={styles.barra} aria-label="Navegação principal">
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === ativo ? `${styles.item} ${styles.ativo}` : styles.item}
          aria-current={item.id === ativo ? 'page' : undefined}
          onClick={() => aoIrPara(item.id)}
        >
          {item.icone}
          {item.rotulo}
        </button>
      ))}

      <button
        type="button"
        className={styles.item}
        onClick={aoAbrirPerfil}
        aria-label={`Perfil ${perfil.nome}. Tocar para abrir o painel de perfil.`}
      >
        <span className={styles.inicial} style={{ background: perfil.acento }}>
          {perfil.inicial}
        </span>
        {perfil.nome}
      </button>
    </nav>
  );
}
