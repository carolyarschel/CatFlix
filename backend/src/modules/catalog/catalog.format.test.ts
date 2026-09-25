import { describe, expect, it } from 'vitest';
import {
  formatarEstreia,
  formatarNotaImdb,
  formatarNotaRt,
  formatarSessao,
  linhaDeCinema,
  salaMaisNotavel,
} from './catalog.format';

/**
 * Passo 10. Testa a formatação que o card de pôster mostra.
 *
 * O caso que justifica o arquivo é o de fuso: o Catploy pode rodar em UTC, e um
 * horário de pré-estreia errado por três horas manda a Carol ao cinema no dia
 * seguinte. O resto protege contra separador solto e nota com ponto.
 */

const SP = 'America/Sao_Paulo';

describe('salaMaisNotavel', () => {
  it('escolhe pela prioridade do room-types.json, não pela ordem recebida', () => {
    expect(salaMaisNotavel(['laser', 'imax'])).toBe('imax');
    expect(salaMaisNotavel(['vip', '4dx', 'xd'])).toBe('4dx');
  });

  it('prefere um formato conhecido a um que o ingresso acabou de inventar', () => {
    expect(salaMaisNotavel(['formato-novo', 'xd'])).toBe('xd');
  });

  it('aceita o formato desconhecido quando é o único', () => {
    expect(salaMaisNotavel(['formato-novo'])).toBe('formato-novo');
  });

  it('sem sala nenhuma devolve null', () => {
    expect(salaMaisNotavel([])).toBeNull();
  });
});

describe('linhaDeCinema', () => {
  it('monta "Kinoplex · XD · DUB"', () => {
    expect(
      linhaDeCinema({ cinema: 'Kinoplex', salas: ['xd'], audios: ['dublado'], tem3d: false }),
    ).toBe('Kinoplex · XD · DUB');
  });

  it('não deixa separador solto quando falta uma parte', () => {
    expect(linhaDeCinema({ cinema: 'Cinemark', salas: [], audios: [], tem3d: false })).toBe(
      'Cinemark',
    );
  });

  it('omite o áudio quando o filme passa dublado E legendado — nenhum dos dois descreve o filme', () => {
    expect(
      linhaDeCinema({
        cinema: 'Cinépolis',
        salas: ['vip'],
        audios: ['dublado', 'legendado'],
        tem3d: false,
      }),
    ).toBe('Cinépolis · VIP');
  });

  it('usa 3D como sala quando não há formato de sala', () => {
    expect(
      linhaDeCinema({ cinema: 'UCI', salas: [], audios: ['dublado'], tem3d: true }),
    ).toBe('UCI · 3D · DUB');
  });

  it('sem nada devolve null, e não uma string de separadores', () => {
    expect(linhaDeCinema({ cinema: null, salas: [], audios: [], tem3d: false })).toBeNull();
  });
});

describe('notas', () => {
  it('usa vírgula decimal, como se lê em pt-BR', () => {
    expect(formatarNotaImdb(8.5)).toBe('8,5');
    expect(formatarNotaImdb(7)).toBe('7,0');
  });

  it('nota ausente não vira "0" nem "—": some (§5.3)', () => {
    expect(formatarNotaImdb(null)).toBeNull();
    expect(formatarNotaRt(null)).toBeNull();
  });

  it('Rotten Tomatoes sai com o símbolo de porcentagem', () => {
    expect(formatarNotaRt(92)).toBe('92%');
  });
});

describe('horários no fuso da cidade', () => {
  it('formata a faixa de pré-estreia como "Qui · 23h59"', () => {
    // 2026-09-25T02:59:00Z = quinta 23h59 em São Paulo (UTC-3)
    expect(formatarSessao(new Date('2026-09-25T02:59:00Z'), SP)).toBe('Qui · 23h59');
  });

  it('NÃO usa o fuso do servidor: a mesma data em UTC cai no dia seguinte', () => {
    const instante = new Date('2026-09-25T02:59:00Z');
    expect(formatarSessao(instante, SP)).toBe('Qui · 23h59');
    expect(formatarSessao(instante, 'UTC')).toBe('Sex · 02h59');
  });

  it('vira o dia certo na meia-noite local', () => {
    // 2026-09-24T03:00:00Z = quinta 00h00 em São Paulo
    expect(formatarSessao(new Date('2026-09-24T03:00:00Z'), SP)).toBe('Qui · 00h00');
  });

  it('formata estreia como "15 out", sem zero à esquerda', () => {
    expect(formatarEstreia(new Date('2026-10-15T12:00:00Z'), SP)).toBe('15 out');
    expect(formatarEstreia(new Date('2026-01-05T12:00:00Z'), SP)).toBe('5 jan');
  });
});
