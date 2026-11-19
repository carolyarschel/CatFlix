import { Badge } from '../../shared/components/Badge';
import { BottomNav } from '../../shared/components/BottomNav';
import { CabecalhoDaAba } from '../../shared/components/CabecalhoDaAba';
import { IconeAgenda, IconeOlho, IconeRevisar } from '../../shared/components/Icones';
import { SeloDePessoa } from '../../shared/components/SeloDePessoa';
import { useApi } from '../../shared/hooks/useApi';
import type { ContagemDaRevisao, PerfilDoApp } from '../../shared/api/tipos';
import styles from './MaisPage.module.scss';

/**
 * A aba "Mais" (cineon-expansao §8): Revisar, configurações e "Sobre", com as
 * atribuições que o TMDB exige (§5.4).
 *
 * Revisar segue a regra original (§2): **sem pendência, o item não aparece** —
 * nem cinza, nem com "0".
 */
export function MaisPage({
  perfil,
  aoNavegar,
}: {
  perfil: PerfilDoApp;
  aoNavegar: (para: string) => void;
}) {
  const revisao = useApi<ContagemDaRevisao>('/review/count');
  const pendencias = revisao.dados?.total ?? 0;

  return (
    <div className={styles.tela}>
      <div className={styles.ambiente} aria-hidden="true" />

      <CabecalhoDaAba titulo="Mais" aoAdicionar={() => aoNavegar('/adicionar')} />

      <main className={styles.conteudo}>
        <ul className={styles.lista}>
          <li>
            <button type="button" className={styles.item} onClick={() => aoNavegar('/perfil')}>
              <SeloDePessoa perfilId={perfil.id} acento={perfil.acento} tamanho={36} />
              <span className={styles.textos}>
                <span className={styles.nome}>{perfil.nome}</span>
                <span className={styles.detalhe}>Perfil, notificações e estado do sync</span>
              </span>
            </button>
          </li>

          {pendencias > 0 ? (
            <li>
              <button type="button" className={styles.item} onClick={() => aoNavegar('/revisar')}>
                <span className={styles.icone}>
                  <IconeRevisar />
                  <Badge valor={pendencias} />
                </span>
                <span className={styles.textos}>
                  <span className={styles.nome}>Revisar</span>
                  <span className={styles.detalhe}>
                    {pendencias === 1 ? '1 filme esperando' : `${pendencias} filmes esperando`} uma decisão
                  </span>
                </span>
              </button>
            </li>
          ) : null}

          <li>
            <button type="button" className={styles.item} onClick={() => aoNavegar('/programacao')}>
              <span className={styles.icone}>
                <IconeAgenda />
              </span>
              <span className={styles.textos}>
                <span className={styles.nome}>Programação por data</span>
                <span className={styles.detalhe}>Tudo o que passa num dia, nos três cinemas</span>
              </span>
            </button>
          </li>

          <li>
            <button type="button" className={styles.item} onClick={() => aoNavegar('/importar-cg')}>
              <span className={styles.icone}>
                <IconeOlho />
              </span>
              <span className={styles.textos}>
                <span className={styles.nome}>Importar do Crônicas de Gatur</span>
                <span className={styles.detalhe}>Os filmes que vocês registraram no CG antigo</span>
              </span>
            </button>
          </li>
        </ul>

        {/* §5.4: atribuições obrigatórias */}
        <section className={styles.sobre} aria-labelledby="sobre">
          <h2 id="sobre" className={styles.rotulo}>
            Sobre
          </h2>
          <a
            className={styles.logoTmdb}
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="TMDB"
          >
            {/* o logo oficial, da página de atribuição do TMDB */}
            <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" />
          </a>
          <p>
            Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Metadados, elenco,
            pôsteres e a busca de filmes vêm do{' '}
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer noopener">
              TMDB
            </a>
            .
          </p>
          <p>
            Onde assistir: dados de streaming do{' '}
            <a href="https://www.justwatch.com/br" target="_blank" rel="noreferrer noopener">
              JustWatch
            </a>
            , pelo TMDB.
          </p>
          <p>Notas do IMDb e do Rotten Tomatoes: OMDb. Sessões e cinemas: ingresso.com.</p>
        </section>
      </main>

      <BottomNav ativa="mais" aoNavegar={aoNavegar} />
    </div>
  );
}
