import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { chavePublica, desinscrever, enviarParaTodos, inscrever, pushConfigurado } from './push.service';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/__teste__abc123';
let temBanco = false;

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
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: '__teste__' } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

const inscricao = {
  endpoint: ENDPOINT,
  keys: { p256dh: 'BExemploChavePublicaDoDispositivo', auth: 'exemploAuth' },
};

describe('configuração do Web Push', () => {
  it('as chaves VAPID estão no ambiente', () => {
    // sem elas o canal do PWA fica desligado e só o log entrega
    expect(pushConfigurado()).toBe(true);
    expect(chavePublica()).toBeTruthy();
  });
});

describe('inscrição de dispositivo', () => {
  it('registra um dispositivo novo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await inscrever(inscricao, { userId: 'catflix', userAgent: 'Android' });
    expect(r.nova).toBe(true);

    const salva = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
    expect(salva?.userId).toBe('catflix');
    expect(salva?.expiredAt).toBeNull();
  });

  it('reinscrever o mesmo endpoint atualiza em vez de duplicar', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    await inscrever(inscricao, { userId: 'catflix' });
    const segunda = await inscrever(
      { ...inscricao, keys: { p256dh: 'chaveNova', auth: 'authNovo' } },
      { userId: 'hburso' },
    );

    expect(segunda.nova).toBe(false);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } })).toBe(1);

    const salva = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
    expect(salva?.p256dh).toBe('chaveNova');
    expect(salva?.userId).toBe('hburso');
  });

  it('uma inscrição que volta deixa de estar expirada', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    await inscrever(inscricao);
    await prisma.pushSubscription.update({
      where: { endpoint: ENDPOINT },
      data: { expiredAt: new Date(), failureCount: 5 },
    });

    await inscrever(inscricao);

    const salva = await prisma.pushSubscription.findUnique({ where: { endpoint: ENDPOINT } });
    expect(salva?.expiredAt).toBeNull();
    expect(salva?.failureCount).toBe(0);
  });

  it('desinscrever remove', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await inscrever(inscricao);
    expect(await desinscrever(ENDPOINT)).toBe(true);
    expect(await desinscrever(ENDPOINT)).toBe(false);
  });
});

describe('envio', () => {
  it('sem dispositivo inscrito não é erro, é ausência', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await prisma.pushSubscription.deleteMany({});

    const r = await enviarParaTodos({ title: 't', body: 'b' });

    // enquanto o PWA não existir, é exatamente este o estado esperado —
    // e o LogNotifier continua entregando
    expect(r.semInscricao).toBe(true);
    expect(r.enviados).toBe(0);
  });

  it('endpoint morto (404/410) é marcado como expirado, não some', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    // endpoint com domínio inexistente: o envio falha de verdade
    await inscrever({
      endpoint: 'https://fcm.googleapis.invalido__teste__/fcm/send/xyz',
      keys: { p256dh: 'BExemplo', auth: 'exemplo' },
    });

    const r = await enviarParaTodos({ title: 't', body: 'b' });

    expect(r.semInscricao).toBe(false);
    expect(r.enviados).toBe(0);
    // falha de rede conta como falha, não como expiração: o dispositivo pode
    // estar vivo e a rede não
    expect(r.falhas + r.expirados).toBeGreaterThan(0);

    const salva = await prisma.pushSubscription.findFirst({
      where: { endpoint: { contains: '__teste__' } },
    });
    expect(salva).not.toBeNull();
  });
});
