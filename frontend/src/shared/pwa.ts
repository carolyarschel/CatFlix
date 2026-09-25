/**
 * Registro do service worker.
 *
 * ⚠️ **Por que no boot, e não só ao ligar as notificações.** Era o que fazia
 * antes: o `useNotificacoes` registrava na hora de inscrever o aparelho. Duas
 * coisas quebravam com isso — o navegador só considera o app instalável quando
 * já existe um service worker no escopo, então "Adicionar à Tela de Início"
 * aparecia tarde ou não aparecia; e o app instalado abria sem nada em cache,
 * mostrando a página de erro do navegador quando o celular estava sem sinal.
 *
 * Falha em silêncio de propósito: service worker é melhoria, não requisito. Sem
 * ele o app continua funcionando como página normal — só não instala nem recebe
 * push.
 */
export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // depois do `load`: registrar durante o carregamento disputa banda com o
  // JavaScript e o CSS da primeira tela
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // sem console.error: em dev o Vite serve o /sw.js e isto é ruído
    });
  });
}
