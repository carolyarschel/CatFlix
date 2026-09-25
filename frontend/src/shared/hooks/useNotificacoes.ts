import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { rodandoInstalado } from './useInstalacao';

/**
 * Web Push do PWA — o canal de alerta escolhido no §3.
 *
 * ⚠️ **A restrição que manda nesta tela:** no iOS o Safari só entrega Web Push
 * quando o app está **instalado na tela de início** (16.4+). Aberto pelo
 * navegador, `PushManager` nem existe — não há inscrição, não há erro, não
 * chega nada. A Carol usa iPhone e é quem mais acompanha a fila de revisão, e é
 * por isso que `precisa_instalar` é um estado próprio aqui, com passo a passo na
 * tela, e não uma linha de texto solta.
 *
 * O Android do HBUrso funciona pelo navegador, sem instalar.
 */

export type EstadoDasNotificacoes =
  | 'carregando'
  /** o navegador não faz Web Push (e não é o caso do iOS sem instalar) */
  | 'sem_suporte'
  /** iOS aberto no navegador: instalar é a única saída */
  | 'precisa_instalar'
  /** o servidor está sem chaves VAPID — não adianta pedir permissão */
  | 'sem_chave'
  /** a pessoa bloqueou nas configurações do navegador; só ela reverte */
  | 'bloqueado'
  | 'desligado'
  /** falando com o serviço de push — medido em ~2s no Chrome */
  | 'ligando'
  | 'ligado';

export interface Notificacoes {
  estado: EstadoDasNotificacoes;
  /** roda no iPhone/iPad, instalado ou não — decide qual passo a passo mostrar */
  ehIOS: boolean;
  instalado: boolean;
  /** quantos aparelhos estão inscritos hoje, segundo o backend */
  dispositivos: number | null;
  erro: string | null;
  ativar: () => Promise<void>;
  desativar: () => Promise<void>;
}

interface ChaveDePush {
  habilitado: boolean;
  chavePublica: string | null;
  dispositivosInscritos: number;
}

/** iPhone, iPod e o iPad moderno, que se apresenta como Mac com toque. */
function detectarIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iP(hone|od|ad)/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * A chave VAPID viaja em base64url e o `subscribe` quer bytes.
 * `atob` não entende `-` e `_`, então a tradução é obrigatória.
 */
function chaveEmBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + preenchimento).replace(/-/g, '+').replace(/_/g, '/');
  const cru = window.atob(base64);

  // o buffer vem explícito porque `applicationServerKey` recusa um
  // `Uint8Array<ArrayBufferLike>`: SharedArrayBuffer não serve ali
  const bytes = new Uint8Array(new ArrayBuffer(cru.length));
  for (let i = 0; i < cru.length; i += 1) bytes[i] = cru.charCodeAt(i);
  return bytes;
}

/**
 * O service worker já é registrado no boot (`shared/pwa.ts`); aqui só se espera
 * por ele. O `register` continua como rede de segurança para o caso de o
 * registro do boot ter falhado — sem isso, ligar as notificações daria um erro
 * sem explicação.
 */
async function servicoPronto(): Promise<ServiceWorkerRegistration> {
  const existente = await navigator.serviceWorker.getRegistration('/');
  if (existente) return existente;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export function useNotificacoes(): Notificacoes {
  const [estado, setEstado] = useState<EstadoDasNotificacoes>('carregando');
  const [dispositivos, setDispositivos] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ehIOS = detectarIOS();
  const instalado = rodandoInstalado();

  const apurar = useCallback(async () => {
    const temApi =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    if (!temApi) {
      // no iPhone fora da tela de início a API simplesmente não existe. Dizer
      // "seu navegador não suporta" seria mentira: ele suporta, instalado.
      setEstado(ehIOS && !instalado ? 'precisa_instalar' : 'sem_suporte');
      return;
    }

    let chave: ChaveDePush;
    try {
      chave = await api.get<ChaveDePush>('/push/chave');
      setDispositivos(chave.dispositivosInscritos);
    } catch {
      setErro('Não consegui falar com o servidor.');
      setEstado('sem_suporte');
      return;
    }

    if (!chave.habilitado || !chave.chavePublica) {
      setEstado('sem_chave');
      return;
    }

    if (Notification.permission === 'denied') {
      setEstado('bloqueado');
      return;
    }

    const registro = await navigator.serviceWorker.getRegistration('/');
    const inscricao = registro ? await registro.pushManager.getSubscription() : null;

    setEstado(inscricao && Notification.permission === 'granted' ? 'ligado' : 'desligado');
  }, [ehIOS, instalado]);

  useEffect(() => {
    void apurar();
  }, [apurar]);

  const ativar = useCallback(async () => {
    setErro(null);
    // o `subscribe` conversa com o FCM/APNs e demora ~2s. Sem este estado o
    // botão fica parado parecendo que o toque não pegou, e um segundo toque
    // dispara o fluxo de novo.
    setEstado('ligando');

    try {
      const chave = await api.get<ChaveDePush>('/push/chave');
      if (!chave.habilitado || !chave.chavePublica) {
        setEstado('sem_chave');
        return;
      }

      // O pedido de permissão precisa sair do toque da pessoa. Registrar o
      // service worker antes é rápido, mas esperar a ativação dele aqui
      // gastaria o gesto e o Safari recusaria o prompt.
      const permissao = await Notification.requestPermission();
      if (permissao === 'denied') {
        setEstado('bloqueado');
        return;
      }
      if (permissao !== 'granted') {
        setEstado('desligado');
        return;
      }

      const registro = await servicoPronto();
      await navigator.serviceWorker.ready;

      const inscricao =
        (await registro.pushManager.getSubscription()) ??
        (await registro.pushManager.subscribe({
          // obrigatório no Chrome e no Safari: nenhum push silencioso
          userVisibleOnly: true,
          applicationServerKey: chaveEmBytes(chave.chavePublica),
        }));

      const json = inscricao.toJSON();
      await api.post('/push/inscrever', {
        endpoint: inscricao.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });

      setEstado('ligado');
      await apurar();
    } catch (problema) {
      setErro(problema instanceof Error ? problema.message : 'Não consegui ligar as notificações.');
      // volta ao estado real em vez de ficar preso em "ligando"
      await apurar();
    }
  }, [apurar]);

  const desativar = useCallback(async () => {
    setErro(null);

    try {
      const registro = await navigator.serviceWorker.getRegistration('/');
      const inscricao = registro ? await registro.pushManager.getSubscription() : null;

      if (inscricao) {
        // o backend primeiro: se o navegador cancelar e o servidor não souber,
        // ele segue tentando entregar num endpoint morto até o contador de
        // falhas expirar a inscrição
        await api.post('/push/desinscrever', { endpoint: inscricao.endpoint });
        await inscricao.unsubscribe();
      }

      setEstado('desligado');
      await apurar();
    } catch (problema) {
      setErro(
        problema instanceof Error ? problema.message : 'Não consegui desligar as notificações.',
      );
    }
  }, [apurar]);

  return { estado, ehIOS, instalado, dispositivos, erro, ativar, desativar };
}
