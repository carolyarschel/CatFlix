import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { definirNota } from '../ratings';
import { listarAssistidos } from './library.assistidos';
import { registrarQueAssistimos } from './library.service';

/**
 * A aba "Assistidos" (cineon-expansao §8), contra o banco de desenvolvimento.
 * As asserções só falam dos títulos que o próprio teste cria (`q: PREFIXO`).
 */

const PREFIXO = '__teste__assistidos';

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
  await prisma.genre.deleteMany({ where: { name: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string, genero?: string) {
  const t = await prisma.title.create({
    data: { title: `${PREFIXO}${sufixo}`, normalizedTitle: `${PREFIXO}${sufixo}`, status: 'matched' },
    select: { id: true },
  });
  if (genero) {
    const g = await prisma.genre.upsert({
      where: { name: genero },
      update: {},
      create: { name: genero },
      select: { id: true },
    });
    await prisma.titleGenre.create({ data: { titleId: t.id, genreId: g.id } });
  }
  return t;
}

describe('listarAssistidos', () => {
  it('um card por filme, o mais recente primeiro, com a data como foi dita', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const revisto = await titulo('-revisto');
    const antigo = await titulo('-antigo');
    await registrarQueAssistimos(revisto.id, { data: '2020', local: 'CASA', participantes: ['CAT'] });
    await registrarQueAssistimos(revisto.id, { data: '2026-11-10', local: 'CASA', participantes: ['BEAR'] });
    await registrarQueAssistimos(antigo.id, { data: '2019-07', local: 'CASA', participantes: ['CAT'] });

    const { itens } = await listarAssistidos({ q: PREFIXO });

    expect(itens.map((i) => i.id)).toEqual([revisto.id, antigo.id]);
    expect(itens[0]).toMatchObject({ vezes: 2, faixa: '10/11/2026', linha: 'Em casa · 2 vezes' });
    // quem assistiu em alguma das vezes: os dois rostos
    expect(itens[0]!.marcadoPor.map((m) => m.userId)).toEqual(['catflix', 'hburso']);
    expect(itens[1]).toMatchObject({ faixa: 'jul 2019', ultimaVez: { data: '2019-07', precisao: 'MES' } });
  });

  it('filtra por gênero e por nota mínima de qualquer um dos dois', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const terror = await titulo('-terror', `${PREFIXO} Terror`);
    const comedia = await titulo('-comedia', `${PREFIXO} Comédia`);
    for (const t of [terror, comedia]) {
      await registrarQueAssistimos(t.id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT', 'BEAR'] });
    }
    await definirNota(terror.id, 'BEAR', 9);
    await definirNota(comedia.id, 'CAT', 6.5);

    const porGenero = await listarAssistidos({ q: PREFIXO, genero: `${PREFIXO} Terror` });
    expect(porGenero.itens.map((i) => i.id)).toEqual([terror.id]);

    const porNota = await listarAssistidos({ q: PREFIXO, notaMin: 8 });
    expect(porNota.itens.map((i) => i.id)).toEqual([terror.id]);
    expect(porNota.itens[0]!.notas).toEqual([{ pessoa: 'BEAR', nota: 9 }]);

    // as facetas só oferecem o que existe
    expect(porNota.facetas.generos).toEqual(
      expect.arrayContaining([`${PREFIXO} Comédia`, `${PREFIXO} Terror`]),
    );
    expect(porNota.facetas.anos).toContain(2026);
  });

  it('visualização removida não conta', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-removida');
    const { visualizacao } = await registrarQueAssistimos(t.id, {
      data: '2026-11-01',
      local: 'CASA',
      participantes: ['CAT'],
    });
    await prisma.watch.update({ where: { id: visualizacao.id }, data: { removedAt: new Date() } });

    expect((await listarAssistidos({ q: PREFIXO })).itens).toEqual([]);
  });
});
