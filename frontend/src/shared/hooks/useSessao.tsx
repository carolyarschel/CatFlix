import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RETORNO, redirecionarParaLogin } from 'gatur-portao-client/react';
import { ApiError, aoPerderSessao, api } from '../api/client';
import type { PerfilDoApp } from '../api/tipos';

/**
 * Sessão do app.
 *
 * Dois modos, decididos pelo backend (`modoLogin` em `/auth/sessao`):
 *
 * - **`portao`** — login pelo Portão de Gatur. Sem sessão, o app vai ao Portão
 *   (que, com a sessão dele viva, devolve sem mostrar tela nenhuma). O Portão
 *   pode recusar (papel sem acesso) ou o login voltar com erro: aí o app para
 *   e mostra o motivo, em vez de redirecionar em círculo.
 * - **`senha`** — o login antigo (§3, 23/09/2026): seletor de perfil e senha
 *   do `.env`. Continua valendo enquanto o Portão não estiver configurado.
 *
 * Nos dois, o token não passa por aqui: vive num cookie `httpOnly`. O que este
 * contexto guarda é só **quem está logado**, e a resposta vem sempre do backend.
 */

export type ModoLogin = 'portao' | 'senha';
export type RetornoDoPortao = 'sem-acesso' | 'erro' | null;

interface Sessao {
  perfil: PerfilDoApp | null;
  perfis: PerfilDoApp[];
  carregando: boolean;
  modoLogin: ModoLogin;
  /** Modo Portão: por que não há sessão (o Portão recusou, ou o login deu erro). */
  retornoDoPortao: RetornoDoPortao;
  /**
   * Não foi possível nem perguntar quem está logado.
   *
   * É diferente de "deslogado", e a diferença virou visível quando o app passou
   * a ser instalável: aberto pelo ícone sem sinal, ele cai no login — e sem
   * isto a tela mostrava "Quem está entrando?" sem nenhum perfil para escolher
   * e sem dizer por quê.
   */
  semServidor: boolean;
  /** Modo senha. */
  entrar: (perfil: string, senha: string) => Promise<void>;
  /** Modo Portão: vai ao Portão entrar e volta para cá. */
  entrarPeloPortao: () => void;
  sair: () => Promise<void>;
  reconsultar: () => Promise<void>;
}

interface RespostaDaSessao {
  perfil: PerfilDoApp | null;
  perfis: PerfilDoApp[];
  modoLogin?: ModoLogin;
}

function lerRetornoDoPortao(): RetornoDoPortao {
  const valor = new URLSearchParams(window.location.search).get('portao');
  if (valor === RETORNO.semAcesso) return 'sem-acesso';
  if (valor === RETORNO.erro) return 'erro';
  return null;
}

const ContextoDaSessao = createContext<Sessao | null>(null);

export function ProvedorDeSessao({ children }: { children: React.ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilDoApp | null>(null);
  const [perfis, setPerfis] = useState<PerfilDoApp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semServidor, setSemServidor] = useState(false);
  const [modoLogin, setModoLogin] = useState<ModoLogin>('senha');
  const [retornoDoPortao, setRetornoDoPortao] = useState<RetornoDoPortao>(null);
  // o ouvinte de 401 é registrado uma vez; precisa ler o modo atual
  const modoRef = useRef<ModoLogin>('senha');

  const consultar = useCallback(async () => {
    try {
      const resposta = await api.get<RespostaDaSessao>('/auth/sessao');
      const modo = resposta.modoLogin ?? 'senha';
      modoRef.current = modo;
      setModoLogin(modo);
      setPerfis(resposta.perfis);
      setSemServidor(false);

      if (modo === 'portao' && !resposta.perfil) {
        const retorno = lerRetornoDoPortao();
        setRetornoDoPortao(retorno);
        // sem sessão e sem recusa: vai ao Portão (e mantém "carregando" na tela)
        if (!retorno) {
          redirecionarParaLogin();
          return;
        }
      }
      setPerfil(resposta.perfil);
    } catch {
      // backend fora do ar: trata como deslogado. A tela de login sabe dizer
      // que não conseguiu falar com o servidor; a home não saberia.
      setPerfil(null);
      setSemServidor(true);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  // Qualquer 401 de qualquer tela derruba a sessão na hora. No modo Portão, é a
  // janela da sessão que venceu: renova pelo Portão e volta para a mesma tela.
  useEffect(
    () =>
      aoPerderSessao(() => {
        if (modoRef.current === 'portao') redirecionarParaLogin();
        else setPerfil(null);
      }),
    [],
  );

  const entrar = useCallback(async (id: string, senha: string) => {
    const resposta = await api.post<{ perfil: PerfilDoApp }>('/auth/login', {
      perfil: id,
      senha,
    });
    setPerfil(resposta.perfil);
    setSemServidor(false);
  }, []);

  const entrarPeloPortao = useCallback(() => redirecionarParaLogin('/'), []);

  const sair = useCallback(async () => {
    if (modoRef.current === 'portao') {
      // encerra a sessão do Cineon e a do Portão (que avisa os outros apps)
      const { url } = await api.post<{ url: string }>('/portao/sair');
      window.location.assign(url);
      return;
    }

    try {
      await api.post('/auth/logout');
    } catch (problema) {
      // 401 aqui significa que a sessão já tinha caído: sair mesmo assim
      if (!(problema instanceof ApiError)) throw problema;
    }
    setPerfil(null);
  }, []);

  const valor = useMemo<Sessao>(
    () => ({
      perfil,
      perfis,
      carregando,
      modoLogin,
      retornoDoPortao,
      semServidor,
      entrar,
      entrarPeloPortao,
      sair,
      reconsultar: consultar,
    }),
    [perfil, perfis, carregando, modoLogin, retornoDoPortao, semServidor, entrar, entrarPeloPortao, sair, consultar],
  );

  return <ContextoDaSessao.Provider value={valor}>{children}</ContextoDaSessao.Provider>;
}

export function useSessao(): Sessao {
  const contexto = useContext(ContextoDaSessao);
  if (!contexto) {
    throw new Error('useSessao precisa estar dentro de <ProvedorDeSessao>');
  }
  return contexto;
}
