import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import type { PerfilDoApp } from '../../shared/api/tipos';
import { useProfile } from '../../shared/hooks/useProfile';
import { useSessao } from '../../shared/hooks/useSessao';
import styles from './LoginPage.module.scss';

/**
 * Tela de login (§3, resolvido em 23/09/2026): escolhe um dos dois perfis e
 * entra com a senha definida no `.env`.
 *
 * Não há modelo de design para esta tela, e pela decisão do mesmo dia isso
 * significa seguir o estilo das que já existem: fundo escuro, faixa de
 * ambiente, tipografia display no título, alvo de toque de 44 px.
 *
 * Escolher o perfil **já troca o acento da tela**. É o mesmo mecanismo do
 * critério de aceite nº 7, e aqui serve de confirmação: dá para ver em quem se
 * está entrando antes de digitar a senha.
 */
export function LoginPage() {
  const { perfis, entrar, semServidor, reconsultar } = useSessao();
  const [escolhido, setEscolhido] = useState<PerfilDoApp | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // pré-visualiza o acento do perfil selecionado, antes de haver sessão
  useProfile(escolhido?.id ?? null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!escolhido || enviando) return;

    setEnviando(true);
    setErro(null);

    try {
      await entrar(escolhido.id, senha);
    } catch (problema) {
      setErro(
        problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.',
      );
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <div className={styles.conteudo}>
        <header className={styles.cabecalho}>
          <h1 className={styles.titulo}>Filmes</h1>
          <p className={styles.subtitulo}>Quem está entrando?</p>
        </header>

        {/* Aberto pelo ícone sem sinal, o app cai aqui. Dizer o que houve — e
            dar o caminho de volta — é melhor do que uma lista de perfis vazia. */}
        {semServidor ? (
          <div className={styles.semServidor} role="alert">
            <p>Não consegui falar com o servidor.</p>
            <p className={styles.dica}>
              Sem internet, ou o servidor está fora do ar. O app abriu do próprio aparelho, mas
              precisa do servidor para entrar.
            </p>
            <button type="button" className={styles.tentar} onClick={() => void reconsultar()}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        <div className={styles.perfis} role="radiogroup" aria-label="Escolha o perfil">
          {perfis.map((perfil) => {
            const ativo = escolhido?.id === perfil.id;
            return (
              <button
                key={perfil.id}
                type="button"
                role="radio"
                aria-checked={ativo}
                className={ativo ? `${styles.perfil} ${styles.ativo}` : styles.perfil}
                style={ativo ? { borderColor: perfil.acento } : undefined}
                onClick={() => {
                  setEscolhido(perfil);
                  setErro(null);
                }}
              >
                <span className={styles.inicial} style={{ background: perfil.acento }}>
                  {perfil.inicial}
                </span>
                {perfil.nome}
              </button>
            );
          })}
        </div>

        {/* o campo de senha só aparece depois da escolha: um formulário inteiro
            de uma vez pergunta duas coisas quando a primeira decide a segunda */}
        {escolhido ? (
          <form className={styles.formulario} onSubmit={enviar}>
            <label className={styles.rotulo} htmlFor="senha">
              Senha de {escolhido.nome}
            </label>
            <input
              id="senha"
              className={styles.campo}
              type="password"
              value={senha}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setSenha(e.target.value)}
              // sem placeholder: num campo de senha, qualquer sugestão vira uma
              // fileira de bolinhas indistinguível de uma senha já digitada —
              // depois de um erro, parecia que o campo não tinha sido limpo
            />

            {erro ? (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            ) : null}

            <button type="submit" className={styles.entrar} disabled={!senha || enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
