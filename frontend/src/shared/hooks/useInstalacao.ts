import { useEffect, useState } from 'react';

/**
 * Convite de instalação do PWA.
 *
 * O Chrome (Android, e o desktop) avisa que o app é instalável pelo evento
 * `beforeinstallprompt` e deixa o site guardá-lo para pedir na hora certa. É o
 * caminho do HBUrso.
 *
 * ⚠️ **O iPhone não tem nada disso.** O Safari nunca dispara o evento: instalar
 * no iOS é o passo a passo manual do "Adicionar à Tela de Início", que a tela
 * de perfil mostra. Por isso este hook devolve `disponivel: false` lá, e a
 * tela **não** conclui daí que o app não é instalável — ela pergunta se é iOS.
 */

interface EventoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstalacao(): {
  disponivel: boolean;
  instalado: boolean;
  instalar: () => Promise<'accepted' | 'dismissed' | 'indisponivel'>;
} {
  const [evento, setEvento] = useState<EventoDeInstalacao | null>(null);
  const [instalado, setInstalado] = useState(() => rodandoInstalado());

  useEffect(() => {
    const aoPoderInstalar = (e: Event) => {
      // sem isto o Chrome mostra a própria barrinha, e o convite apareceria
      // duas vezes na mesma tela
      e.preventDefault();
      setEvento(e as EventoDeInstalacao);
    };

    const aoInstalar = () => {
      setInstalado(true);
      setEvento(null);
    };

    window.addEventListener('beforeinstallprompt', aoPoderInstalar);
    window.addEventListener('appinstalled', aoInstalar);

    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  async function instalar() {
    if (!evento) return 'indisponivel' as const;

    await evento.prompt();
    const { outcome } = await evento.userChoice;

    // o evento é de uso único: depois de usado, o navegador só manda outro se
    // a pessoa recusar e voltar mais tarde
    setEvento(null);
    return outcome;
  }

  return { disponivel: evento !== null && !instalado, instalado, instalar };
}

/** Instalado = rodando fora da moldura do navegador. */
export function rodandoInstalado(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // o Safari do iOS não implementa display-mode e usa esta propriedade própria
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
