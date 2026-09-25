import { HomePage } from './modules/home/HomePage';
import { ListaPage } from './modules/home/ListaPage';
import { LoginPage } from './modules/profile/LoginPage';
import { PerfilPage } from './modules/profile/PerfilPage';
import { RevisarPage } from './modules/review/RevisarPage';
import { FilmePage } from './modules/title-detail/FilmePage';
import { useProfile } from './shared/hooks/useProfile';
import { useRota } from './shared/hooks/useRota';
import { useSessao } from './shared/hooks/useSessao';

/**
 * Casca do app.
 *
 * Três estados antes de qualquer rota: consultando a sessão, deslogado (tela de
 * login) e dentro. Todo o app fica atrás do login (§3) — não há nada aqui que
 * seja público, então não há rota pública.
 */
export function App() {
  const { perfil, carregando } = useSessao();
  const { rota, navegar, voltar } = useRota();

  // o tema segue quem está logado
  useProfile(perfil?.id ?? null);

  if (carregando) return null;
  if (!perfil) return <LoginPage />;

  // `/health` é para onde o Web Push dos canaries aponta (`pwa-push.notifier`).
  // O §11 previa uma tela própria de estado do sync; ela acabou dentro da de
  // perfil, junto das notificações, porque quem clica no alerta quer as duas
  // coisas no mesmo lugar: o que quebrou e como continuar sendo avisado.
  if (rota.caminho === '/perfil' || rota.caminho === '/health') {
    return <PerfilPage perfil={perfil} aoVoltar={voltar} />;
  }

  if (rota.caminho === '/revisar') {
    return <RevisarPage aoVoltar={voltar} />;
  }

  if (rota.caminho === '/lista' && rota.parametro) {
    return (
      <ListaPage
        key={rota.parametro}
        trilhaId={rota.parametro}
        perfil={perfil}
        aoVoltar={voltar}
        aoAbrir={(idDoFilme) => navegar(`/filme/${idDoFilme}`)}
      />
    );
  }

  if (rota.caminho === '/filme' && rota.parametro) {
    // `key` força uma tela nova ao trocar de filme: sem isso, abrir outro filme
    // a partir deste reaproveitaria o estado do anterior e a página apareceria
    // com os dados do filme errado até a resposta chegar
    return (
      <FilmePage key={rota.parametro} id={rota.parametro} perfil={perfil} aoVoltar={voltar} />
    );
  }

  return <HomePage perfil={perfil} aoNavegar={navegar} />;
}
