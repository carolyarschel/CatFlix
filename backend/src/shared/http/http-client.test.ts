import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http-client';

/**
 * O que estes testes protegem é a política de acesso do §5.1, não o fetch.
 */

function respostaFalsa(corpo: Uint8Array | string, init: ResponseInit = {}): Response {
  return new Response(corpo, { status: 200, ...init });
}

const clienteBase = () =>
  new HttpClient({ source: 'teste', baseUrl: 'https://exemplo.test', baseDelayMs: 1 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decodificação do corpo', () => {
  it('respeita charset=utf-16 em vez de assumir utf-8', async () => {
    // O ingresso devolve UTF-16 em alguns endpoints; response.text() entregaria lixo.
    const json = JSON.stringify({ items: [{ name: 'Cinema Anália Franco' }], count: 1 });
    const utf16 = new Uint8Array(json.length * 2);
    for (let i = 0; i < json.length; i += 1) {
      const code = json.charCodeAt(i);
      utf16[i * 2] = code & 0xff;
      utf16[i * 2 + 1] = code >> 8;
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaFalsa(utf16, { headers: { 'content-type': 'application/json; charset=utf-16' } }),
    );

    const resposta = await clienteBase().request('/teste');

    expect(resposta.json<{ count: number }>().count).toBe(1);
    expect(resposta.bodyText).toContain('Anália Franco');
  });

  it('decodifica utf-8 normalmente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaFalsa(JSON.stringify({ title: 'Divertida Mente 2' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    const resposta = await clienteBase().request('/teste');
    expect(resposta.json<{ title: string }>().title).toBe('Divertida Mente 2');
  });

  it('cai para utf-8 se o charset declarado for inválido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaFalsa(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json; charset=nao-existe' },
      }),
    );

    const resposta = await clienteBase().request('/teste');
    expect(resposta.json<{ ok: boolean }>().ok).toBe(true);
  });
});

describe('política de acesso', () => {
  it('tenta de novo em 429 e respeita o Retry-After', async () => {
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        respostaFalsa('', { status: 429, headers: { 'retry-after': '0' } }),
      )
      .mockResolvedValueOnce(
        respostaFalsa(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );

    const eventos: string[] = [];
    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      baseDelayMs: 1,
      onTransportEvent: (e) => eventos.push(e.outcome),
    });

    const resposta = await cliente.request('/teste');

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(resposta.attempts).toBe(2);
    expect(eventos).toEqual(['rate_limited', 'ok']);
  });

  it('não tenta de novo em 403 e reporta bloqueio', async () => {
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respostaFalsa('', { status: 403 }));

    const eventos: string[] = [];
    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      baseDelayMs: 1,
      onTransportEvent: (e) => eventos.push(e.outcome),
    });

    const resposta = await cliente.request('/teste');

    // 403 é bloqueio, não instabilidade: insistir só piora
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(resposta.status).toBe(403);
    expect(eventos).toEqual(['forbidden']);
  });

  it('com retryEmpty400, trata 400 vazio como throttle e tenta de novo', async () => {
    // o ingresso.com sinaliza throttle com 400 + corpo vazio, não com 429
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respostaFalsa('', { status: 400 }))
      .mockResolvedValueOnce(
        respostaFalsa(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );

    const eventos: string[] = [];
    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      baseDelayMs: 1,
      retryEmpty400: true,
      onTransportEvent: (e) => eventos.push(e.outcome),
    });

    const resposta = await cliente.request('/teste');

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(resposta.status).toBe(200);
    expect(eventos).toEqual(['rate_limited', 'ok']);
  });

  it('com retryEmpty400, NÃO insiste num 400 que veio com corpo', async () => {
    // 400 com mensagem é erro do nosso pedido: repetir só gasta a API
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respostaFalsa('{"erro":"cityId inválido"}', { status: 400 }));

    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      baseDelayMs: 1,
      retryEmpty400: true,
    });

    const resposta = await cliente.request('/teste');

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(resposta.status).toBe(400);
  });

  it('sem retryEmpty400, um 400 vazio não é repetido', async () => {
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respostaFalsa('', { status: 400 }));

    const resposta = await clienteBase().request('/teste');

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(resposta.status).toBe(400);
  });

  it('nunca ultrapassa a concorrência máxima', async () => {
    let simultaneas = 0;
    let pico = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      await new Promise((r) => setTimeout(r, 5));
      simultaneas -= 1;
      return respostaFalsa('{}', { headers: { 'content-type': 'application/json' } });
    });

    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      maxConcurrency: 4,
    });

    await Promise.all(Array.from({ length: 20 }, () => cliente.request('/teste')));

    expect(pico).toBeLessThanOrEqual(4);
  });

  it('manda o User-Agent configurado', async () => {
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respostaFalsa('{}', { headers: { 'content-type': 'application/json' } }));

    const cliente = new HttpClient({
      source: 'teste',
      baseUrl: 'https://exemplo.test',
      userAgent: 'AppFilmes/0.1 (uso pessoal)',
    });
    await cliente.request('/teste');

    const init = fetchFalso.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('AppFilmes/0.1 (uso pessoal)');
  });

  it('devolve o corpo cru sem parsear, para gravar RawPayload antes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaFalsa('isto não é json', { headers: { 'content-type': 'application/json' } }),
    );

    const resposta = await clienteBase().request('/teste');

    expect(resposta.bodyText).toBe('isto não é json');
    expect(() => resposta.json()).toThrow();
  });
});
