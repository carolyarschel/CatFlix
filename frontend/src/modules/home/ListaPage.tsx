import { useMemo } from 'react';
import { IconeVoltar } from '../../shared/components/Icones';
import { PosterCard } from '../../shared/components/PosterCard';
import { useApi } from '../../shared/hooks/useApi';
import { fonteDaTrilha } from '../../shared/api/trilhas';
import type { ListaDeTitulos, PerfilDoApp } from '../../shared/api/tipos';
import styles from './ListaPage.module.scss';

/**
 * Uma trilha inteira, sem o corte de 24 da home.
 *
 * Existe porque a trilha é horizontal e limitada, e o que passava do corte
 * **sumia do app** sem nenhum sinal — em 24/09/2026 eram 8 filmes em cartaz,
 * sempre os de menos sessões, ou seja o filme pequeno e o que está acabando.
 *
 * Refaz a pergunta em `GET /titles` em vez de pedir uma home sem corte: a home
 * é uma requisição só, montada para ser leve, e não faz sentido engordá-la por
 * causa de uma tela que quase nunca é aberta.
 */
export function ListaPage({
  trilhaId,
  perfil,
  aoVoltar,
  aoAbrir,
}: {
  trilhaId: string;
  perfil: PerfilDoApp;
  aoVoltar: () => void;
  aoAbrir: (id: string) => void;
}) {
  const fonte = fonteDaTrilha(trilhaId);

  const query = useMemo(() => {
    if (!fonte) return {};
    return {
      ...(fonte.availability ? { availability: fonte.availability } : {}),
      ...(fonte.status ? { status: fonte.status } : {}),
      ...(fonte.porUsuario ? { user: perfil.id } : {}),
    };
  }, [fonte, perfil.id]);

  const lista = useApi<ListaDeTitulos>('/titles', { query, ativo: Boolean(fonte) });

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <header className={styles.cabecalho}>
        <button type="button" className={styles.voltar} onClick={aoVoltar} aria-label="Voltar">
          <IconeVoltar />
        </button>

        <div className={styles.titulos}>
          <h1 className={styles.titulo}>{fonte?.titulo ?? 'Lista'}</h1>
          {lista.dados ? (
            <p className={styles.contagem}>
              {lista.dados.total === 1 ? '1 filme' : `${lista.dados.total} filmes`}
            </p>
          ) : null}
        </div>
      </header>

      {/* trilha que não existe é URL digitada à mão, ou link velho depois de um
          rename: dizer isso é melhor do que uma tela vazia sem explicação */}
      {!fonte ? (
        <p className={styles.aviso}>Não conheço a lista "{trilhaId}".</p>
      ) : lista.carregando && !lista.dados ? (
        <p className={styles.aviso}>Carregando…</p>
      ) : lista.erro ? (
        <div className={styles.aviso} role="alert">
          <p>{lista.erro}</p>
          <button type="button" className={styles.tentar} onClick={lista.recarregar}>
            Tentar de novo
          </button>
        </div>
      ) : lista.dados && lista.dados.itens.length === 0 ? (
        <p className={styles.aviso}>Nada por aqui ainda.</p>
      ) : (
        <main className={styles.grade}>
          {lista.dados?.itens.map((item) => (
            <PosterCard key={item.id} titulo={item} aoAbrir={aoAbrir} />
          ))}
        </main>
      )}
    </div>
  );
}
