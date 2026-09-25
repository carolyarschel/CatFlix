import { useCallback, useEffect, useState } from 'react';

/**
 * Navegação do app, sobre a History API.
 *
 * Por que não um roteador: o app tem meia dúzia de telas e nenhuma rota
 * aninhada, com parâmetro opcional ou carregamento preguiçoso. O que um
 * roteador resolveria aqui, trinta linhas resolvem — e o §4 fixa a stack sem
 * mencionar nenhum.
 *
 * O que **não** dá para abrir mão, e por isso isto usa History API em vez de
 * um `useState` com o nome da tela: o **botão voltar do Android**. O HBUrso usa
 * Android, e num PWA instalado o voltar do sistema é o voltar do app. Com
 * estado em memória, ele fecharia o app no meio da fila de revisão.
 */

export type Rota = { caminho: string; parametro: string | null };

function lerRota(): Rota {
  const partes = window.location.pathname.split('/').filter(Boolean);
  return { caminho: `/${partes[0] ?? ''}`, parametro: partes[1] ?? null };
}

export function useRota(): { rota: Rota; navegar: (para: string) => void; voltar: () => void } {
  const [rota, setRota] = useState<Rota>(lerRota);

  useEffect(() => {
    // dispara no voltar/avançar do navegador E no botão físico do Android
    const aoVoltar = () => setRota(lerRota());
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);

  const navegar = useCallback((para: string) => {
    if (para === window.location.pathname) return;
    window.history.pushState(null, '', para);
    setRota(lerRota());
    window.scrollTo({ top: 0 });
  }, []);

  const voltar = useCallback(() => {
    // se já há histórico, volta de verdade — assim o gesto de voltar do
    // celular e o botão da tela concordam
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', '/');
    setRota(lerRota());
  }, []);

  return { rota, navegar, voltar };
}
