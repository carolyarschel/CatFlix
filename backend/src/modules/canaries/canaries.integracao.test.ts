import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { abrirAlerta, alertasAbertos, registrarChecagem, resolverAlerta } from './alerts';
import { ObservadorDeTransporte } from './canaries.service';
import { LogNotifier, NotifierComposto, type Aviso, type Notifier } from './notifier';

const ALVO = '__teste__canary';
let temBanco = false;

/** Notifier que grava o que recebeu, para afirmar o que FOI enviado. */
class NotifierEspiao implements Notifier {
  readonly nome = 'espiao';
  readonly recebidos: Aviso[] = [];
  async enviar(aviso: Aviso): Promise<string[]> {
    this.recebidos.push(aviso);
    return [this.nome];
  }
}

class NotifierQuebrado implements Notifier {
  readonly nome = 'quebrado';
  async enviar(): Promise<string[]> {
    throw new Error('canal fora do ar');
  }
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterEach(async () => {
  if (!temBanco) return;
  await prisma.alert.deleteMany({ where: { fingerprint: { contains: ALVO } } });
  await prisma.canaryCheck.deleteMany({ where: { target: { contains: ALVO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

describe('§8 — checagem e alerta andam juntos', () => {
  it('checagem que passa não abre alerta', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();

    const r = await registrarChecagem(
      { layer: 'semantic', target: ALVO, passed: true, measuredValue: 34 },
      espiao,
    );

    expect(r.alertId).toBeNull();
    expect(espiao.recebidos).toHaveLength(0);

    const check = await prisma.canaryCheck.findUnique({ where: { id: r.checkId } });
    expect(check?.passed).toBe(true);
    expect(check?.measuredValue).toBe(34);
  });

  it('checagem que falha grava o histórico E avisa', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();

    const r = await registrarChecagem(
      {
        layer: 'semantic',
        target: ALVO,
        passed: false,
        measuredValue: 4,
        threshold: 20,
        message: 'eventos despencaram',
      },
      espiao,
    );

    expect(r.avisou).toBe(true);
    expect(espiao.recebidos[0]?.mensagem).toBe('eventos despencaram');
    // o histórico permite calibrar o limiar depois; o alerta interrompe agora
    expect(await prisma.canaryCheck.count({ where: { target: ALVO } })).toBe(1);
  });
});

describe('§8 — não reenviar o mesmo alerta enquanto não resolvido', () => {
  it('o segundo disparo do mesmo problema não avisa de novo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();

    const falha = { layer: 'transport' as const, target: ALVO, passed: false, message: 'caiu' };

    await registrarChecagem(falha, espiao);
    await registrarChecagem(falha, espiao);
    await registrarChecagem(falha, espiao);

    // três checagens no histórico, UM aviso: senão um sync de 5 em 5 horas
    // viraria spam até alguém olhar
    expect(await prisma.canaryCheck.count({ where: { target: ALVO } })).toBe(3);
    expect(espiao.recebidos).toHaveLength(1);
    expect(await prisma.alert.count({ where: { fingerprint: { contains: ALVO }, resolvedAt: null } })).toBe(1);
  });

  it('quando a checagem volta a passar, o alerta é resolvido', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();

    await registrarChecagem({ layer: 'transport', target: ALVO, passed: false, message: 'caiu' }, espiao);
    expect((await alertasAbertos()).some((a) => a.fingerprint.includes(ALVO))).toBe(true);

    await registrarChecagem({ layer: 'transport', target: ALVO, passed: true }, espiao);
    expect((await alertasAbertos()).some((a) => a.fingerprint.includes(ALVO))).toBe(false);
  });

  it('resolvido e voltando a falhar, avisa de novo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();
    const falha = { layer: 'transport' as const, target: ALVO, passed: false, message: 'caiu' };

    await registrarChecagem(falha, espiao);
    await resolverAlerta(`transport:${ALVO}`);
    await registrarChecagem(falha, espiao);

    expect(espiao.recebidos).toHaveLength(2);
  });

  it('o banco garante a unicidade, não só o código', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const espiao = new NotifierEspiao();

    // dois jobs detectando o mesmo problema ao mesmo tempo
    const resultados = await Promise.allSettled([
      abrirAlerta({ fingerprint: `x:${ALVO}`, severity: 'warning', message: 'a' }, espiao),
      abrirAlerta({ fingerprint: `x:${ALVO}`, severity: 'warning', message: 'b' }, espiao),
    ]);

    const abertos = await prisma.alert.count({
      where: { fingerprint: `x:${ALVO}`, resolvedAt: null },
    });
    // o índice parcial `alerts_one_open_per_fingerprint` não deixa passar dois
    expect(abertos).toBe(1);
    expect(resultados.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });
});

describe('canal de aviso fora do ar', () => {
  it('o alerta fica registrado mesmo se o envio falhar', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await abrirAlerta(
      { fingerprint: `y:${ALVO}`, severity: 'critical', message: 'problema real' },
      new NotifierQuebrado(),
    );

    const alerta = await prisma.alert.findUnique({ where: { id: r.alertId } });
    expect(alerta).not.toBeNull();
    // sem `sentAt`: o /health/sync mostra que o aviso não saiu
    expect(alerta?.sentAt).toBeNull();
  });

  it('um canal quebrado não impede os outros', async (ctx: TestContext) => {
    const espiao = new NotifierEspiao();
    const composto = new NotifierComposto([new NotifierQuebrado(), espiao, new LogNotifier()]);

    await composto.enviar({
      severity: 'warning',
      titulo: 't',
      mensagem: 'm',
      fingerprint: 'f',
    });

    expect(espiao.recebidos).toHaveLength(1);
  });
});

describe('canary de transporte', () => {
  it('403 isolado é ruído; três é bloqueio', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const evento = (outcome: 'ok' | 'forbidden') => ({
      source: ALVO,
      endpoint: '/x',
      url: 'https://x',
      outcome,
      attempts: 1,
      durationMs: 10,
    });

    const poucos = new ObservadorDeTransporte();
    poucos.observar(evento('forbidden'));
    for (let i = 0; i < 9; i += 1) poucos.observar(evento('ok'));
    await poucos.registrar();

    const umSo = await prisma.canaryCheck.findFirst({
      where: { target: `${ALVO}:http` },
      orderBy: { checkedAt: 'desc' },
    });
    expect(umSo?.passed).toBe(true);

    const muitos = new ObservadorDeTransporte();
    for (let i = 0; i < 3; i += 1) muitos.observar(evento('forbidden'));
    await muitos.registrar();

    const bloqueio = await prisma.canaryCheck.findFirst({
      where: { target: `${ALVO}:http` },
      orderBy: { checkedAt: 'desc' },
    });
    expect(bloqueio?.passed).toBe(false);
    expect(bloqueio?.message).toContain('bloqueio');

    const alerta = await prisma.alert.findFirst({
      where: { fingerprint: `transport:${ALVO}:http`, resolvedAt: null },
    });
    expect(alerta?.severity).toBe('critical');
  });
});

/**
 * Regressão encontrada ao ligar o Web Push: o alerta era marcado como
 * ENVIADO mesmo quando o push falhava, porque o composto engole a falha de um
 * canal para não derrubar os outros. A Carol leria "enviado: sim" no
 * /health/sync e suporia que a notificação chegou ao celular.
 */
describe('o alerta só é "enviado" se alguém entregou de verdade', () => {
  class NotifierMudo implements Notifier {
    readonly nome = 'mudo';
    async enviar(): Promise<string[]> {
      return []; // não falhou, mas também não entregou
    }
  }

  it('registra QUAIS canais entregaram, não só que tentou', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const espiao = new NotifierEspiao();
    const composto = new NotifierComposto([espiao, new NotifierQuebrado()]);

    const r = await abrirAlerta(
      { fingerprint: `z:${ALVO}`, severity: 'warning', message: 'meio entregue' },
      composto,
    );

    const alerta = await prisma.alert.findUnique({ where: { id: r.alertId } });
    expect(alerta?.sentAt).not.toBeNull();
    // só o espião entregou; o canal quebrado não aparece
    expect(alerta?.notifier).toBe('espiao');
    expect(alerta?.notifier).not.toContain('quebrado');
  });

  it('nenhum canal entregando deixa o alerta SEM data de envio', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await abrirAlerta(
      { fingerprint: `w:${ALVO}`, severity: 'critical', message: 'ninguém recebeu' },
      new NotifierMudo(),
    );

    const alerta = await prisma.alert.findUnique({ where: { id: r.alertId } });
    expect(alerta).not.toBeNull();
    expect(alerta?.sentAt).toBeNull();
    expect(alerta?.notifier).toBeNull();
  });
});
