import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, aoPerderSessao, api } from '../api/client';
import type { PerfilDoApp } from '../api/tipos';

/**
 * Sessão do app (§3, resolvido em 23/09/2026: tela de login com seletor de
 * perfil e senha do `.env`).
 *
 * O token não passa por aqui: ele vive num cookie `httpOnly` que o JavaScript
 * não enxerga. O que este contexto guarda é só **quem está logado**, e a
 * resposta vem sempre do backend — assim uma sessão vencida no servidor não
 * fica parecendo válida na tela.
 */

interface Sessao {
  perfil: PerfilDoApp | null;
  perfis: PerfilDoApp[];
  carregando: boolean;
  /**
   * Não foi possível nem perguntar quem está logado.
   *
   * É diferente de "deslogado", e a diferença virou visível quando o app passou
   * a ser instalável: aberto pelo ícone sem sinal, ele cai no login — e sem
   * isto a tela mostrava "Quem está entrando?" sem nenhum perfil para escolher
   * e sem dizer por quê.
   */
  semServidor: boolean;
  entrar: (perfil: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  reconsultar: () => Promise<void>;
}

interface RespostaDaSessao {
  perfil: PerfilDoApp | null;
  perfis: PerfilDoApp[];
}

const ContextoDaSessao = createContext<Sessao | null>(null);

export function ProvedorDeSessao({ children }: { children: React.ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilDoApp | null>(null);
  const [perfis, setPerfis] = useState<PerfilDoApp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semServidor, setSemServidor] = useState(false);

  const consultar = useCallback(async () => {
    try {
      const resposta = await api.get<RespostaDaSessao>('/auth/sessao');
      setPerfil(resposta.perfil);
      setPerfis(resposta.perfis);
      setSemServidor(false);
    } catch {
      // backend fora do ar: trata como deslogado. A tela de login sabe dizer
      // que não conseguiu falar com o servidor; a home não saberia.
      setPerfil(null);
      setSemServidor(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  // Qualquer 401 de qualquer tela derruba a sessão na hora. Sem isto, um cookie
  // vencido durante o uso deixaria a home tentando carregar para sempre.
  useEffect(() => aoPerderSessao(() => setPerfil(null)), []);

  const entrar = useCallback(async (id: string, senha: string) => {
    const resposta = await api.post<{ perfil: PerfilDoApp }>('/auth/login', {
      perfil: id,
      senha,
    });
    setPerfil(resposta.perfil);
    setSemServidor(false);
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (problema) {
      // 401 aqui significa que a sessão já tinha caído: sair mesmo assim
      if (!(problema instanceof ApiError)) throw problema;
    }
    setPerfil(null);
  }, []);

  const valor = useMemo<Sessao>(
    () => ({ perfil, perfis, carregando, semServidor, entrar, sair, reconsultar: consultar }),
    [perfil, perfis, carregando, semServidor, entrar, sair, consultar],
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
