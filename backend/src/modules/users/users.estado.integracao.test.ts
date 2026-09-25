import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { listarTitulos, montarHome } from '../catalog/catalog.queries';
import { marcarDisponibilidade } from '../cinemas/cinemas.service';
import { definirEstado, limparEstado } from './users.service';

/**
 * Passo 11 — `UserTitleState`.
 *
 * Duas coisas aqui não são detalhe de implementação:
 *
 * 1. **O estado do usuário é separado de `Availability`** (§6). Um filme sair
 *    de cartaz não pode apagar a marcação da Carol, e é isso que o primeiro
 *    teste trava.
 * 2. **As três datas são histórico, não espelho do status.** "Quero ver" em
 *    março e "visto" em maio: as duas ficam. É o que permite responder quanto
 *    tempo ela esperou por um filme — e o que o §13 vai usar quando o "visto"
 *    começar a chegar por webhook do Jellyfin.
 */

const PREFIXO = '__teste__estado';

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
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string) {
  return prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status: 'matched',
    },
    select: { id: true },
  });
}

async function linha(userId: string, titleId: string) {
  return prisma.userTitleState.findUnique({
    where: { userId_titleId: { userId, titleId } },
    select: { status: true, wantedAt: true, markedAt: true, watchedAt: true, source: true },
  });
}

describe('UserTitleState', () => {
  it('sair de cartaz não apaga a marcação — §6', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-em-cartaz');
    await marcarDisponibilidade([t.id], 'em_cartaz');
    await definirEstado('catflix', t.id, 'marcado');

    // o filme sai de cartaz: o sync fecha a disponibilidade
    await prisma.availability.updateMany({
      where: { titleId: t.id, status: 'em_cartaz' },
      data: { endedAt: new Date() },
    });

    expect((await linha('catflix', t.id))?.status).toBe('marcado');
  });

  it('as três datas somam, não se substituem', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-historico');

    await definirEstado('catflix', t.id, 'quero_ver');
    const quis = (await linha('catflix', t.id))?.wantedAt;

    await definirEstado('catflix', t.id, 'marcado');
    await definirEstado('catflix', t.id, 'visto');

    const fim = await linha('catflix', t.id);
    expect(fim?.status).toBe('visto');
    // a data de "quero ver" continua lá, com o valor original
    expect(fim?.wantedAt?.getTime()).toBe(quis?.getTime());
    expect(fim?.markedAt).toBeInstanceOf(Date);
    expect(fim?.watchedAt).toBeInstanceOf(Date);
  });

  it('cada perfil tem o seu estado no mesmo filme', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-dois-perfis');
    await definirEstado('catflix', t.id, 'marcado');
    await definirEstado('hburso', t.id, 'visto');

    expect((await linha('catflix', t.id))?.status).toBe('marcado');
    expect((await linha('hburso', t.id))?.status).toBe('visto');
  });

  it('desmarcar apaga a linha, e desmarcar de novo não é erro', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-desmarca');
    await definirEstado('catflix', t.id, 'marcado');

    expect(await limparEstado('catflix', t.id)).toBe(true);
    expect(await linha('catflix', t.id)).toBeNull();
    expect(await limparEstado('catflix', t.id)).toBe(false);
  });

  it('a marcação aparece no card e na trilha "Já marcados por vocês"', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-na-home');
    await definirEstado('catflix', t.id, 'marcado');

    const home = await montarHome('catflix', { limitePorTrilha: Number.MAX_SAFE_INTEGER });
    const trilha = home.trilhas.find((x) => x.id === 'marcados');
    const card = trilha?.itens.find((i) => i.id === t.id);

    expect(card, 'o filme marcado não entrou na trilha de marcados').toBeDefined();
    // o círculo com a inicial no canto do pôster (§12)
    expect(card?.marcadoPor.map((m) => m.userId)).toEqual(['catflix']);
  });

  it('o filtro por estado da lista responde ao que foi marcado', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const querVer = await titulo('-quer-ver');
    const visto = await titulo('-visto');
    await definirEstado('catflix', querVer.id, 'quero_ver');
    await definirEstado('catflix', visto.id, 'visto');

    const lista = await listarTitulos({ user: 'catflix', status: 'quero_ver', limite: 10_000 });
    const ids = lista.map((x) => x.id);

    expect(ids).toContain(querVer.id);
    expect(ids).not.toContain(visto.id);
  });

  it('a origem fica "app" — o §13 vai distinguir o que vier do Jellyfin', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-origem');
    await definirEstado('catflix', t.id, 'visto');

    expect((await linha('catflix', t.id))?.source).toBe('app');
  });
});
