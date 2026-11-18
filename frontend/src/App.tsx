import { AdicionarPage } from './modules/acervo/AdicionarPage';
import { HomePage } from './modules/home/HomePage';
import { ListaPage } from './modules/home/ListaPage';
import { LoginPage } from './modules/profile/LoginPage';
import { PerfilPage } from './modules/profile/PerfilPage';
import { PortaoPage } from './modules/profile/PortaoPage';
import { ProgramacaoPage } from './modules/programacao/ProgramacaoPage';
import { RevisarPage } from './modules/review/RevisarPage';
import { DetalhePage } from './modules/title-detail/DetalhePage';
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
  const { perfil, carregando, modoLogin } = useSessao();
  const { rota, navegar, voltar } = useRota();

  // o tema segue quem está logado
  useProfile(perfil?.id ?? null);

  if (carregando) return null;
  // modo Portão: sem perfil aqui = o Portão recusou ou o login falhou (no caminho
  // feliz o app já foi ao Portão e voltou logado); modo senha: tela de login
  if (!perfil) return modoLogin === 'portao' ? <PortaoPage /> : <LoginPage />;

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

  // o "+" do cabeçalho (cineon-expansao §4.1)
  if (rota.caminho === '/adicionar') {
    return (
      <AdicionarPage
        perfil={perfil}
        aoVoltar={voltar}
        aoAbrir={(idDoFilme) => navegar(`/filme/${idDoFilme}`)}
      />
    );
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

  if (rota.caminho === '/programacao') {
    // o parâmetro é o dia (`/programacao/2026-11-21`); sem ele, o backend
    // responde hoje. A tela troca o dia na própria URL com `replaceState`,
    // então não há `key` aqui: remontar a cada dia perderia o filtro de cinema
    return (
      <ProgramacaoPage
        diaInicial={rota.parametro}
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
      <DetalhePage
        key={rota.parametro}
        id={rota.parametro}
        perfil={perfil}
        aoVoltar={voltar}
        aoNavegar={navegar}
      />
    );
  }

  return <HomePage perfil={perfil} aoNavegar={navegar} />;
}
