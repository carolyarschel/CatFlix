import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { marcarDisponibilidade } from './cinemas.service';

/**
 * A regra `EM_CARTAZ_GANHA_DOS_FUTUROS` (ver `cinemas.service.ts`).
 *
 * O que estes testes protegem é a ordem dos jobs. `sessoes` roda às
 * 06h/13h/20h e `proximos` às 05h30 — um teste que só chamasse
 * `marcarDisponibilidade` na ordem boa passaria sem provar nada. Por isso os
 * dois sentidos estão aqui, e um deles é explicitamente a ordem ruim.
 */

const PREFIXO = '__teste__disp';

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

/** As disponibilidades ABERTAS do título, que é o que a home enxerga. */
async function abertas(titleId: string): Promise<string[]> {
  const linhas = await prisma.availability.findMany({
    where: { titleId, source: 'cinema', endedAt: null },
    select: { status: true },
  });

  return linhas.map((l) => l.status).sort();
}

describe('marcarDisponibilidade — em cartaz ganha de em breve e de pré-estreia', () => {
  it('abrir em_cartaz fecha a em_breve que já estava aberta', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // a ordem real: o `proximos` das 05h30 já tinha anunciado o filme
    const t = await titulo('-estreou');
    await marcarDisponibilidade([t.id], 'em_breve');
    expect(await abertas(t.id)).toEqual(['em_breve']);

    // e às 06h ele apareceu com sessão
    await marcarDisponibilidade([t.id], 'em_cartaz');

    expect(await abertas(t.id)).toEqual(['em_cartaz']);
  });

  it('o `proximos` do dia seguinte não reabre em_breve de quem está em cartaz', async ({
    skip,
  }) => {
    if (!temBanco) skip('sem Postgres');

    // esta é a ordem que fazia a home piscar entre 05h30 e 06h: o ingresso
    // continua listando o filme em "em breve" depois de ele estrear
    const t = await titulo('-em-cartaz');
    await marcarDisponibilidade([t.id], 'em_cartaz');

    const marcados = await marcarDisponibilidade([t.id], 'em_breve');

    expect(marcados).toBe(0);
    expect(await abertas(t.id)).toEqual(['em_cartaz']);
  });

  it('não mexe em quem ainda não estreou', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const futuro = await titulo('-futuro');
    const emCartaz = await titulo('-outro');

    // os dois vêm na mesma lista de "em breve"; só um está em cartaz
    await marcarDisponibilidade([emCartaz.id], 'em_cartaz');
    await marcarDisponibilidade([futuro.id, emCartaz.id], 'em_breve');

    expect(await abertas(futuro.id)).toEqual(['em_breve']);
    expect(await abertas(emCartaz.id)).toEqual(['em_cartaz']);
  });

  it('fecha com endedAt, sem apagar o histórico', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-historico');
    await marcarDisponibilidade([t.id], 'em_breve');
    await marcarDisponibilidade([t.id], 'em_cartaz');

    const linha = await prisma.availability.findFirst({
      where: { titleId: t.id, status: 'em_breve' },
      select: { endedAt: true, firstSeenAt: true },
    });

    // "esteve anunciado como em breve até tal dia" continua respondível
    expect(linha?.endedAt).toBeInstanceOf(Date);
    expect(linha?.firstSeenAt).toBeInstanceOf(Date);
  });

  it('abrir em_cartaz fecha também a pre_estreia', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // filme que estava anunciado como pré-estreia e estreou de verdade
    const t = await titulo('-pre');
    await marcarDisponibilidade([t.id], 'pre_estreia');
    expect(await abertas(t.id)).toEqual(['pre_estreia']);

    await marcarDisponibilidade([t.id], 'em_cartaz');

    expect(await abertas(t.id)).toEqual(['em_cartaz']);
  });

  it('o `proximos` não reabre pre_estreia de quem está em cartaz', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-pre-em-cartaz');
    await marcarDisponibilidade([t.id], 'em_cartaz');

    const marcados = await marcarDisponibilidade([t.id], 'pre_estreia');

    expect(marcados).toBe(0);
    expect(await abertas(t.id)).toEqual(['em_cartaz']);
  });

  it('as duas futuras são fechadas de uma vez quando o filme estreia', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-ambas');
    await marcarDisponibilidade([t.id], 'em_breve');
    await marcarDisponibilidade([t.id], 'pre_estreia');
    expect(await abertas(t.id)).toEqual(['em_breve', 'pre_estreia']);

    await marcarDisponibilidade([t.id], 'em_cartaz');

    expect(await abertas(t.id)).toEqual(['em_cartaz']);
  });

  it('quem ainda não estreou mantém em_breve E pre_estreia juntas', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // as duas juntas são legítimas ANTES da estreia: o ingresso lista o filme
    // em "em breve" e já abre a sessão de pré-estreia
    const t = await titulo('-futuro-duplo');
    await marcarDisponibilidade([t.id], 'em_breve');
    await marcarDisponibilidade([t.id], 'pre_estreia');

    expect(await abertas(t.id)).toEqual(['em_breve', 'pre_estreia']);
  });
});
