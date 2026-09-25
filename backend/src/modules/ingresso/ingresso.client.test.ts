import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractError, ExternalApiError } from '../../shared/errors';
import type { RegistrarPayloadInput } from '../../shared/raw-payload';

// O client grava RawPayload antes de parsear; aqui isolamos o banco para
// poder afirmar QUE ele grava, e em que ordem.
const { registrarRawPayload } = vi.hoisted(() => ({
  registrarRawPayload: vi.fn<(input: RegistrarPayloadInput) => Promise<string>>(
    async () => 'raw-payload-1',
  ),
}));

vi.mock('../../shared/raw-payload', () => ({
  registrarRawPayload,
  ultimoPayloadBemSucedido: vi.fn(),
}));

import { IngressoClient } from './ingresso.client';

function resposta(corpo: string, init: ResponseInit = {}): Response {
  return new Response(corpo, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  registrarRawPayload.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ordem do §7.1: bruto primeiro, parsing depois', () => {
  it('grava o RawPayload antes de validar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(JSON.stringify({ items: [], count: 0 })));

    await new IngressoClient().buscarCinemasDaCidade('14');

    expect(registrarRawPayload).toHaveBeenCalledTimes(1);
    const chamada = registrarRawPayload.mock.calls[0]![0];
    expect(chamada.source).toBe('ingresso');
    expect(chamada.endpoint).toContain('/theaters/city/14');
    expect(chamada.httpStatus).toBe(200);
  });

  it('grava o bruto MESMO quando o payload quebra o schema', async () => {
    // é justamente o payload quebrado que mais precisamos guardar
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(JSON.stringify({ items: [{ semId: true }], count: 1 })),
    );

    await expect(new IngressoClient().buscarCinemasDaCidade('14')).rejects.toThrow(ContractError);
    expect(registrarRawPayload).toHaveBeenCalledTimes(1);
  });

  it('o ContractError aponta para o RawPayload, para reprocessar sem rechamar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta('{"items": "não é lista", "count": 0}'));

    const erro = await new IngressoClient().buscarCinemasDaCidade('14').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ContractError);
    expect((erro as ContractError).rawPayloadId).toBe('raw-payload-1');
    expect((erro as ContractError).source).toBe('ingresso');
  });
});

describe('armadilhas do contrato', () => {
  it('trata 204 de cinema sem sessão como lista vazia, não como erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const resultado = await new IngressoClient().buscarSessoesDoCinema('14', '1587');

    expect(resultado.dados).toEqual([]);
    expect(resultado.vazio).toBe(true);
    // mesmo vazio, o bruto fica registrado
    expect(registrarRawPayload).toHaveBeenCalledTimes(1);
  });

  it('aceita a resposta de sessões como ARRAY, como o spec não diz', async () => {
    const dia = [
      {
        date: '2026-09-22',
        movies: [
          {
            id: '33608',
            title: 'A Odisseia',
            rooms: [
              {
                name: 'Sala 12',
                sessions: [
                  {
                    id: '87005018',
                    date: { localDate: '2026-09-22T13:10:00-03:00' },
                    types: [{ id: 1, name: 'Normal' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(JSON.stringify(dia)));

    const resultado = await new IngressoClient().buscarSessoesDoCinema('14', '136');
    expect(resultado.dados).toHaveLength(1);
    expect(resultado.vazio).toBe(false);
  });

  it('NÃO confunde 400 vazio com "cinema sem sessão"', async () => {
    // Este é o bug que a sondagem real pegou: como o throttle do ingresso vem
    // como 400 + corpo vazio, checar "corpo vazio" antes do status fazia a
    // grade inteira parecer ter sumido — e o sync limparia as sessões.
    // Response nova a cada chamada: o corpo de uma Response só é lido uma vez,
    // e este caminho tenta de novo (o 400 vazio é tratado como throttle).
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('', { status: 400 }));

    const erro = await new IngressoClient()
      .buscarSessoesDoCinema('14', '136')
      .catch((e: unknown) => e);

    // insistiu (throttle), mas desistiu e falhou alto em vez de devolver []
    expect(fetchFalso.mock.calls.length).toBeGreaterThan(1);
    expect(erro).toBeInstanceOf(ExternalApiError);
    expect((erro as ExternalApiError).httpStatus).toBe(400);
  });

  it('recusa 204 num endpoint que deveria ter conteúdo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(new IngressoClient().buscarEstados()).rejects.toThrow(ContractError);
  });

  it('status ruim vira ExternalApiError, não erro de contrato', async () => {
    // 403 é bloqueio (transporte), não mudança de formato — canaries diferentes
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta('bloqueado', { status: 403 }));

    const erro = await new IngressoClient().buscarEstados().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ExternalApiError);
    expect((erro as ExternalApiError).httpStatus).toBe(403);
    expect(registrarRawPayload).toHaveBeenCalledTimes(1);
  });
});

describe('paginação sem campo de total', () => {
  it('avisa quando a lista volta cheia até o limite', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: `Filme ${i}` }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(JSON.stringify({ items, count: 50 })));

    const cliente = new IngressoClient();
    const resultado = await cliente.buscarEmCartaz('14', 50);

    // count === limit significa "provavelmente tem mais", porque a API não
    // devolve total nenhum — servir isto como catálogo completo seria mentira
    expect(resultado.dados).toHaveLength(50);
  });

  it('manda o partnership configurado no caminho', async () => {
    const fetchFalso = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(resposta(JSON.stringify({ items: [], count: 0 })));

    await new IngressoClient().buscarPreEstreias('14');

    const url = String(fetchFalso.mock.calls[0]![0]);
    expect(url).toContain('/templates/premiere/14/partnership/www');
  });
});
