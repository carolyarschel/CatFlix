import { useSessao } from '../../shared/hooks/useSessao';
import styles from './PortaoPage.module.scss';

/**
 * Login pelo Portão de Gatur, quando ele **não** deu certo.
 *
 * No caminho feliz esta tela nem aparece: sem sessão, o app vai direto ao
 * Portão e volta logado. Ela só aparece quando o Portão devolveu uma recusa
 * (o papel não tem acesso ao Cineon) ou o login voltou com erro — aí parar e
 * dizer o motivo é melhor do que redirecionar em círculo. Também cobre o
 * servidor fora do ar, como a tela de senha.
 */
export function PortaoPage() {
  const { retornoDoPortao, semServidor, entrarPeloPortao, reconsultar } = useSessao();

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <div className={styles.conteudo}>
        <header className={styles.cabecalho}>
          <h1 className={styles.titulo}>Filmes</h1>
          <p className={styles.subtitulo}>Entrada pelo Portão de Gatur</p>
        </header>

        <div className={styles.aviso} role="alert">
          {semServidor ? (
            <>
              <p>Não consegui falar com o servidor.</p>
              <p className={styles.dica}>
                Sem internet, ou o servidor está fora do ar. O app abriu do próprio aparelho, mas
                precisa do servidor para entrar.
              </p>
              <button type="button" className={styles.botao} onClick={() => void reconsultar()}>
                Tentar de novo
              </button>
            </>
          ) : retornoDoPortao === 'sem-acesso' ? (
            <>
              <p>Seu perfil não tem acesso a este app.</p>
              <p className={styles.dica}>O Portão de Gatur não liberou a entrada no Filmes.</p>
            </>
          ) : (
            <>
              <p>Não deu para entrar agora.</p>
              <p className={styles.dica}>
                O login pelo Portão não terminou (às vezes ele demora mais de 10 minutos e expira).
              </p>
              <button type="button" className={styles.botao} onClick={entrarPeloPortao}>
                Entrar pelo Portão
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
