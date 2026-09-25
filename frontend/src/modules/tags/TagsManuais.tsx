import { useMemo, useState } from 'react';
import { api } from '../../shared/api/client';
import type { PerfilDoApp, TagDoTitulo } from '../../shared/api/tipos';
import styles from './TagsManuais.module.scss';

/**
 * As tags de um filme, e o campo para acrescentar as suas (§10, passo 11).
 *
 * Duas espécies convivem aqui e **não se parecem de propósito**: as automáticas
 * (sala, cinema, áudio) são derivadas das sessões e o sync as recalcula; as
 * manuais são trabalho das duas pessoas e o sync nunca toca nelas (§6). Só as
 * manuais têm o × de remover — tirar uma automática seria pedir que ela
 * voltasse no sync seguinte, o que pareceria um bug do app.
 *
 * E só dá para remover **a sua**: os dois podem ter "maratona" no mesmo filme,
 * e uma não apaga a da outra pessoa.
 */
export function TagsManuais({
  titleId,
  perfil,
  iniciais,
}: {
  titleId: string;
  perfil: PerfilDoApp;
  iniciais: TagDoTitulo[];
}) {
  const [tags, setTags] = useState(iniciais);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const automaticas = useMemo(() => tags.filter((t) => t.origin !== 'manual'), [tags]);
  const manuais = useMemo(() => tags.filter((t) => t.origin === 'manual'), [tags]);

  async function acrescentar(evento: React.FormEvent) {
    evento.preventDefault();

    const valor = texto.trim();
    if (!valor || salvando) return;

    setSalvando(true);
    setErro(null);

    try {
      const criada = await api.post<TagDoTitulo>(`/titles/${titleId}/tags`, { tag: valor });
      // a mesma tag duas vezes não duplica no banco; aqui também não
      setTags((atuais) => [...atuais.filter((t) => t.id !== criada.id), criada]);
      setTexto('');
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : 'Não consegui salvar a tag.');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(tag: TagDoTitulo) {
    const anterior = tags;
    setErro(null);
    setTags((atuais) => atuais.filter((t) => t.id !== tag.id));

    try {
      await api.delete(`/titles/${titleId}/tags/${tag.id}`);
    } catch (problema) {
      setTags(anterior);
      setErro(problema instanceof Error ? problema.message : 'Não consegui tirar a tag.');
    }
  }

  return (
    <section className={styles.bloco}>
      <h2 className={styles.rotulo}>Tags</h2>

      {automaticas.length > 0 ? (
        <>
          <p className={styles.grupo}>Das sessões</p>
          <ul className={styles.chips}>
            {automaticas.map((tag) => (
              <li key={tag.id} className={styles.chip}>
                {tag.label}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={styles.grupo}>Suas tags</p>

      {manuais.length > 0 ? (
        <ul className={styles.chips}>
          {manuais.map((tag) => {
            const minha = tag.ownerId === perfil.id;

            return (
              <li
                key={tag.id}
                className={minha ? `${styles.chip} ${styles.chipMinha}` : `${styles.chip} ${styles.chipDoOutro}`}
                title={minha ? undefined : 'Tag do outro perfil'}
              >
                {tag.label}
                {minha ? (
                  <button
                    type="button"
                    className={styles.tirar}
                    aria-label={`Tirar a tag ${tag.label}`}
                    onClick={() => void remover(tag)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.vazio}>Nenhuma ainda.</p>
      )}

      <form className={styles.formulario} onSubmit={(e) => void acrescentar(e)}>
        <input
          className={styles.campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="maratona, sessão da madrugada…"
          maxLength={40}
          aria-label="Nova tag"
        />
        <button type="submit" className={styles.adicionar} disabled={!texto.trim() || salvando}>
          {salvando ? '…' : 'Adicionar'}
        </button>
      </form>

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </section>
  );
}
