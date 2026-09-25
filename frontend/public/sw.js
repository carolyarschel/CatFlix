/**
 * Service worker do app.
 *
 * Faz duas coisas: entrega o Web Push dos canaries (§3 e §8) e guarda o
 * **esqueleto** do app para ele abrir instalado, sem rede.
 *
 * ⚠️ **A linha que separa as duas metades, e que não pode ser cruzada:**
 *
 * - O **esqueleto** — HTML, JavaScript, CSS, ícones — é cacheado. Ele não fala
 *   sobre cinema nenhum: é a casca que sabe desenhar telas e dizer "não
 *   consegui falar com o servidor".
 * - Os **dados** — tudo em `/api` — NUNCA são cacheados. Uma grade de sessões
 *   velha servida como se fosse a de hoje mandaria a Carol para um cinema na
 *   hora errada. Quem responde "a API caiu" é o backend, com a idade do dado à
 *   vista (modo degradado do §8) — e para isso ele precisa ser perguntado.
 *
 * Por isso aqui não há regra geral de cache: há uma lista do que pode. O que
 * não está nela passa direto para a rede, e é assim que `/api` fica de fora por
 * construção, não por lembrança.
 *
 * Arquivo servido cru de `public/`, e não montado pelo Vite: um service worker
 * precisa estar na raiz do escopo que controla e não pode ganhar hash no nome.
 */

const VERSAO = 'v1';
const CACHE_ESQUELETO = `filmes-esqueleto-${VERSAO}`;

/**
 * ⚠️ `ignoreVary` é obrigatório aqui, não é otimização.
 *
 * O servidor responde `Vary: Origin` nos assets. O pedido que ESTE arquivo faz
 * para encher o cache sai em modo `cors` e leva o cabeçalho `Origin`; o pedido
 * que a página faz por um `<link rel="stylesheet">` sai em `no-cors` e não leva.
 * Sem `ignoreVary`, o `match` considera os dois pedidos diferentes, não acha
 * nada, cai para a rede — e sem rede o app abre em BRANCO com o CSS e o
 * JavaScript guardados ali do lado. Medido em 25/09/2026.
 */
const BUSCA = { ignoreVary: true };

/** Arquivos fixos que valem a pena ter antes de precisar. */
const ESSENCIAIS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

/**
 * Os arquivos que o `index.html` da vez referencia em `/assets/`.
 *
 * ⚠️ **Por que ler o HTML em vez de listar os nomes.** O Vite põe hash no nome
 * de cada bundle, e este arquivo é servido cru — ele não tem como saber que a
 * build de hoje é `index-DE_DXIls.js`. Ler o HTML resolve sozinho e não precisa
 * de passo de build nem de plugin.
 *
 * ⚠️ **E por que no install, e não deixar o cache se encher sozinho.** Na
 * PRIMEIRA visita o service worker ainda não controla a página: o navegador já
 * baixou o JavaScript e o CSS antes de ele existir, então eles não passam pelo
 * `fetch` daqui e não seriam guardados. Quem instalasse o app e perdesse o
 * sinal antes de abrir uma segunda vez veria **tela branca** — medido em
 * 25/09/2026, e é exatamente a falha que este cache existe para evitar.
 */
async function assetsDoIndex() {
  try {
    const resposta = await fetch('/', { cache: 'reload' });
    if (!resposta.ok) return [];

    const html = await resposta.text();
    const achados = html.match(/\/assets\/[\w.-]+/g) ?? [];
    return [...new Set(achados)];
  } catch {
    return [];
  }
}

self.addEventListener('install', (evento) => {
  // assume o controle sem esperar a próxima aba: uma correção aqui precisa
  // valer no próximo push, não no próximo mês
  self.skipWaiting();

  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_ESQUELETO);
      const alvos = [...ESSENCIAIS, ...(await assetsDoIndex())];

      // um a um, e não `addAll`: com `addAll` um único 404 aborta o lote
      // inteiro e o app fica sem esqueleto nenhum por causa de um ícone
      await Promise.all(
        alvos.map((url) =>
          // `reload` para não semear o cache novo com o que o navegador já
          // tinha guardado da versão anterior
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // versão nova, cache novo: as sobras da anterior iriam apodrecer no disco
      // do celular para sempre
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n.startsWith('filmes-') && n !== CACHE_ESQUELETO).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── Cache: só o esqueleto ────────────────────────────────────

/** Saída do build do Vite: nome com hash, conteúdo imutável. */
function ehAssetComHash(url) {
  return url.pathname.startsWith('/assets/');
}

/** Os poucos arquivos fixos da raiz. Lista fechada, não padrão. */
function ehEstaticoDaRaiz(url) {
  return (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico' ||
    /^\/(icon-[\w-]+|logo-256)\.png$/.test(url.pathname)
  );
}

async function daRedeComCacheDeReserva(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      const cache = await caches.open(CACHE_ESQUELETO);
      await cache.put(requisicao, resposta.clone());
    }
    return resposta;
  } catch (erro) {
    const guardada = await caches.match(requisicao, BUSCA);
    if (guardada) return guardada;
    throw erro;
  }
}

async function doCachePrimeiro(requisicao) {
  const guardada = await caches.match(requisicao, BUSCA);
  if (guardada) return guardada;

  const resposta = await fetch(requisicao);
  if (resposta.ok) {
    const cache = await caches.open(CACHE_ESQUELETO);
    await cache.put(requisicao, resposta.clone());
  }
  return resposta;
}

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  // ⚠️ a linha do começo do arquivo, escrita em código
  if (url.pathname.startsWith('/api/')) return;

  // Navegação: rede primeiro. Assim um deploy novo aparece na hora quando há
  // sinal, e sem sinal o app abre do cache em vez da página de erro do
  // navegador — instalado no celular, essa página é a cara do app quebrado.
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      daRedeComCacheDeReserva(requisicao).catch(
        async () => (await caches.match('/', BUSCA)) ?? Response.error(),
      ),
    );
    return;
  }

  // Asset com hash no nome nunca muda de conteúdo: pedir de novo é desperdício.
  if (ehAssetComHash(url)) {
    evento.respondWith(doCachePrimeiro(requisicao));
    return;
  }

  if (ehEstaticoDaRaiz(url)) {
    evento.respondWith(daRedeComCacheDeReserva(requisicao));
    return;
  }

  // Todo o resto — inclusive os módulos que o Vite serve em desenvolvimento —
  // passa direto. Sem `respondWith`, o navegador trata como se não houvesse
  // service worker nenhum.
});

// ── Web Push (§3 e §8) ───────────────────────────────────────

self.addEventListener('push', (evento) => {
  const padrao = {
    titulo: 'Filmes',
    corpo: 'Alguma coisa mudou no sync.',
    url: '/perfil',
    // sem `tag` o navegador empilha tudo; com uma tag fixa ele colapsaria
    // alertas diferentes num só. A tag certa vem do servidor: é o fingerprint.
    tag: 'filmes-alerta',
  };

  let dados = padrao;
  try {
    // o servidor manda JSON; se um dia mandar texto puro, ele vira o corpo em
    // vez de derrubar a notificação inteira
    const bruto = evento.data ? evento.data.text() : '';
    if (bruto) {
      const json = JSON.parse(bruto);
      dados = {
        titulo: json.titulo || json.title || padrao.titulo,
        corpo: json.corpo || json.body || json.mensagem || padrao.corpo,
        url: json.url || padrao.url,
        tag: json.tag || padrao.tag,
      };
    }
  } catch {
    const texto = evento.data ? evento.data.text() : '';
    if (texto) dados = { ...padrao, corpo: texto };
  }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // O servidor manda o fingerprint do alerta como `tag`, e é ele que decide
      // o que substitui o quê: o §8 diz "não reenviar o mesmo alerta enquanto
      // não resolvido", e a bandeja precisa concordar com isso. Usar a URL aqui
      // colapsaria dois problemas diferentes numa notificação só, porque todos
      // os alertas apontam para a mesma tela.
      tag: dados.tag,
      renotify: false,
      data: { url: dados.url },
    }),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || '/';

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      // reaproveita a janela aberta em vez de abrir uma segunda cópia do app
      for (const janela of janelas) {
        if ('focus' in janela) {
          if ('navigate' in janela) janela.navigate(destino).catch(() => {});
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
