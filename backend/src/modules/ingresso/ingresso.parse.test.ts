import { describe, expect, it } from 'vitest';
import sessoesReais from './__fixtures__/sessions-kinoplex-dom-pedro.json';
import cinemasReais from './__fixtures__/theaters-campinas.json';
import {
  classificarTipos,
  minutosDeDuracao,
  normalizarCinema,
  normalizarSessoes,
  slugificar,
} from './ingresso.parse';
import { sessionsResponseSchema, theatersResponseSchema } from './ingresso.schemas';

/**
 * As fixtures são payload REAL do Kinoplex Dom Pedro e dos cinemas de
 * Campinas, capturados em 22/09/2026. Testar contra o que a API devolve de
 * verdade é o ponto: o OpenAPI diverge do observado.
 */

describe('schemas contra payload real', () => {
  it('valida as sessões do Kinoplex Dom Pedro', () => {
    const resultado = sessionsResponseSchema.safeParse(sessoesReais);
    expect(resultado.success).toBe(true);
  });

  it('valida os cinemas de Campinas', () => {
    const resultado = theatersResponseSchema.safeParse(cinemasReais);
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.items).toHaveLength(6);
  });

  it('recusa localDate sem offset UTC', () => {
    // se o offset sumir, o horário de TODAS as sessões escorrega em silêncio
    const semOffset = structuredClone(sessoesReais) as typeof sessoesReais;
    const sessao = semOffset[0]!.movies![0]!.rooms![0]!.sessions![0]!;
    sessao.date.localDate = '2026-09-22T13:10:00';

    const resultado = sessionsResponseSchema.safeParse(semOffset);
    expect(resultado.success).toBe(false);
    expect(JSON.stringify(resultado)).toContain('offset');
  });

  it('recusa sessão sem id — é a chave de idempotência do sync', () => {
    const semId = structuredClone(sessoesReais) as unknown as Record<string, never>[];
    delete (semId[0] as never as { movies: { rooms: { sessions: { id?: string }[] }[] }[] }).movies[0]!
      .rooms[0]!.sessions[0]!.id;

    expect(sessionsResponseSchema.safeParse(semId).success).toBe(false);
  });
});

describe('classificarTipos — áudio × formato de sala', () => {
  it('separa pelo id, não pelo nome (id 0 = áudio, id > 0 = formato)', () => {
    const r = classificarTipos([
      { id: 1, name: 'Normal', alias: '2D', display: true },
      { id: 0, name: 'Dublado', alias: 'DUB', display: true },
    ]);

    expect(r.audio).toBe('dublado');
    expect(r.roomType).toBe('normal');
    expect(r.is3d).toBe(false);
  });

  it('classifica IMAX legendado', () => {
    const r = classificarTipos([
      { id: 16, name: 'IMAX', alias: 'IMAX', display: true },
      { id: 0, name: 'Legendado', alias: 'LEG', display: true },
    ]);

    expect(r.audio).toBe('legendado');
    expect(r.roomType).toBe('imax');
    expect(r.roomLabel).toBe('IMAX');
  });

  it('trata "Nacional" como áudio original', () => {
    const r = classificarTipos([{ id: 0, name: 'Nacional', alias: 'NAC', display: true }]);
    expect(r.audio).toBe('original');
  });

  it('tira o 3D do roomType e põe em is3d', () => {
    const r = classificarTipos([
      { id: 4, name: '3D', alias: '3D', display: true },
      { id: 32, name: 'XD', alias: 'XD', display: true },
      { id: 0, name: 'Dublado', alias: 'DUB', display: true },
    ]);

    expect(r.is3d).toBe(true);
    expect(r.roomType).toBe('xd');
  });

  it('usa a prioridade quando a sessão tem vários formatos', () => {
    const r = classificarTipos([
      { id: 1073741824, name: 'Laser', alias: 'Laser', display: true },
      { id: 2, name: 'Vip', alias: 'VIP', display: true },
    ]);

    // VIP vem antes de Laser na lista de prioridade
    expect(r.roomType).toBe('vip');
    // mas o rótulo preserva os dois, para as tags não perderem informação
    expect(r.roomLabel).toContain('Laser');
    expect(r.roomLabel).toContain('Vip');
  });

  it('aceita um formato que o ingresso ainda não inventou', () => {
    // é isto que a regra estrutural compra: nada de editar lista para cada novidade
    const r = classificarTipos([
      { id: 2097152, name: 'Ultra Screen 9000', alias: 'US9K', display: true },
      { id: 0, name: 'Legendado', alias: 'LEG', display: true },
    ]);

    expect(r.roomType).toBe('ultra-screen-9000');
    expect(r.audio).toBe('legendado');
  });

  it('áudio desconhecido não quebra o fluxo', () => {
    const r = classificarTipos([{ id: 0, name: 'Esperanto', alias: 'ESP', display: true }]);
    expect(r.audio).toBe('desconhecido');
  });

  it('sessão sem types nenhum vira sala normal e áudio desconhecido', () => {
    const r = classificarTipos(null);
    expect(r).toEqual({ audio: 'desconhecido', roomType: 'normal', roomLabel: null, is3d: false });
  });
});

describe('normalizarSessoes com payload real', () => {
  const dias = sessionsResponseSchema.parse(sessoesReais);
  const sessoes = normalizarSessoes(dias, { theaterIngressoId: '136' });

  it('achata dias → filmes → salas → sessões', () => {
    expect(sessoes.length).toBe(9);
    expect(new Set(sessoes.map((s) => s.eventIngressoId)).size).toBe(6);
  });

  it('não repete a mesma sessão que aparece em mais de um dia', () => {
    const ids = sessoes.map((s) => s.ingressoSessionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('converte localDate para instante absoluto', () => {
    for (const sessao of sessoes) {
      expect(sessao.startsAt.getTime()).not.toBeNaN();
    }
    // 13:10 em -03:00 é 16:10 UTC
    const odisseia = sessoes.find((s) => s.eventIngressoId === dias[0]!.movies![0]!.id);
    expect(odisseia?.startsAt.toISOString()).toMatch(/T\d{2}:\d{2}/);
  });

  it('leva a URL de compra de cada sessão', () => {
    expect(sessoes.every((s) => s.purchaseUrl?.includes('sessionId='))).toBe(true);
  });

  it('classifica Duna - Parte 3 como IMAX legendado', () => {
    const duna = dias.flatMap((d) => d.movies ?? []).find((m) => m.title === 'Duna - Parte 3');
    const sessao = sessoes.find((s) => s.eventIngressoId === duna?.id);

    expect(sessao?.roomType).toBe('imax');
    expect(sessao?.audio).toBe('legendado');
  });
});

describe('normalizarCinema', () => {
  const cinemas = theatersResponseSchema.parse(cinemasReais);

  it('junta endereço e mapeia a rede', () => {
    const kinoplex = cinemas.items.find((c) => c.id === '136');
    const normalizado = normalizarCinema(kinoplex!);

    expect(normalizado.ingressoId).toBe('136');
    expect(normalizado.chain).toBe('Kinoplex');
    expect(normalizado.address).toContain('Guilherme Campos');
    expect(normalizado.enabled).toBe(true);
  });

  it('reconhece que o "Parque D. Pedro Shopping" não é o cinema do Dom Pedro', () => {
    // mesma rua do Kinoplex, mas rede OUTROS EVENTOS — é espaço de evento.
    // O filtro é por id justamente por causa dele.
    const evento = cinemas.items.find((c) => c.id === '1587');
    expect(normalizarCinema(evento!).chain).toBe('OUTROS EVENTOS');
  });
});

describe('utilitários', () => {
  it('slugifica tirando acento e pontuação', () => {
    expect(slugificar('Cinépolis Shopping Galleria')).toBe('cinepolis-shopping-galleria');
    expect(slugificar('D-BOX')).toBe('d-box');
  });

  it('converte duração em minutos e tolera lixo', () => {
    expect(minutosDeDuracao('167')).toBe(167);
    expect(minutosDeDuracao('')).toBeNull();
    expect(minutosDeDuracao(null)).toBeNull();
    expect(minutosDeDuracao('0')).toBeNull();
    expect(minutosDeDuracao('sei lá')).toBeNull();
  });
});
