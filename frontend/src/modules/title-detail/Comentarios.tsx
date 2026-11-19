import { useState } from 'react';
import { ApiError, api } from '../../shared/api/client';
import { SeloDePessoa } from '../../shared/components/SeloDePessoa';
import { PERFIL_DA_PESSOA } from '../../shared/pessoas';
import type { PerfilDoApp, Pessoa, SituacaoDaPessoa } from '../../shared/api/tipos';
import styles from './Comentarios.module.scss';

/**
 * Os comentários de vocês sobre o filme (pedido de 19/11/2026): um por pessoa,
 * editável depois de salvo. Cada um escreve e edita só o seu; o do outro
 * aparece para ler.
 *
 * Comentar não exige ter assistido. Salvar o campo vazio apaga.
 */

const TAMANHO_MAXIMO = 4000;

export function Comentarios({
  titleId,
  eu,
  pessoas,
  corDe,
  aoMudar,
}: {
  titleId: string;
  eu: Pessoa;
  pessoas: SituacaoDaPessoa[];
  corDe: (pessoa: Pessoa) => PerfilDoApp | undefined;
  aoMudar: () => void;
}) {
  const minha = pessoas.find((p) => p.pessoa === eu);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrirEdicao() {
    setTexto(minha?.comentario ?? '');
    setErro(null);
    setEditando(true);
  }

  async function enviar(acao: () => Promise<unknown>) {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
      setEditando(false);
      aoMudar();
    } catch (problema) {
      setErro(problema instanceof ApiError ? problema.message : 'Não consegui salvar o comentário.');
    } finally {
      setEnviando(false);
    }
  }

  const salvar = () => enviar(() => api.put(`/titles/${titleId}/comment`, { texto }));

  const apagar = () => {
    if (!window.confirm('Apagar o seu comentário?')) return;
    void enviar(() => api.delete(`/titles/${titleId}/comment`));
  };

  return (
    <ul className={styles.lista}>
      {pessoas.map((p) => {
        const souEu = p.pessoa === eu;
        // o do outro só aparece quando existe; o meu sempre, para poder escrever
        if (!souEu && !p.comentario) return null;
        const cor = corDe(p.pessoa);

        return (
          <li key={p.pessoa} className={styles.comentario}>
            <SeloDePessoa
              perfilId={PERFIL_DA_PESSOA[p.pessoa]}
              acento={cor?.acento ?? '#A79FB5'}
              tamanho={28}
              rotulo={cor?.nome}
            />

            {souEu && editando ? (
              <form
                className={styles.edicao}
                onSubmit={(e) => {
                  e.preventDefault();
                  void salvar();
                }}
              >
                <textarea
                  className={styles.campo}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  maxLength={TAMANHO_MAXIMO}
                  rows={4}
                  placeholder="O que você achou?"
                  aria-label="Seu comentário sobre o filme"
                  autoFocus
                />
                {erro ? (
                  <p className={styles.erro} role="alert">
                    {erro}
                  </p>
                ) : null}
                <div className={styles.acoes}>
                  <button type="submit" className={styles.salvar} disabled={enviando}>
                    {enviando ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelar}
                    disabled={enviando}
                    onClick={() => setEditando(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.corpo}>
                {p.comentario ? (
                  <p className={styles.texto}>{p.comentario}</p>
                ) : (
                  <p className={styles.vazio}>Você ainda não comentou.</p>
                )}
                {souEu ? (
                  <div className={styles.links}>
                    <button type="button" className={styles.link} disabled={enviando} onClick={abrirEdicao}>
                      {p.comentario ? 'Editar' : 'Escrever um comentário'}
                    </button>
                    {p.comentario ? (
                      <button type="button" className={styles.linkDiscreto} disabled={enviando} onClick={apagar}>
                        Apagar
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {souEu && erro && !editando ? (
                  <p className={styles.erro} role="alert">
                    {erro}
                  </p>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
