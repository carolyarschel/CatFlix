import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { ValidationError } from '../../shared/errors';
import { diaNoFuso, inicioDoDia } from '../cinemas/cinemas.queries';
import { fusoDaCidade, limparCacheDeFuso } from '../cinemas/cinemas.service';
import { programacaoDoDia } from './catalog.queries';

/**
 * A programação de um dia: o que passa, onde e a que horas.
 *
 * Roda contra o banco de desenvolvimento, que tem dado real de Campinas. Por
 * isso as asserções só falam dos títulos que o próprio teste cria.
 */

const PREFIXO = '__teste__programacao';
const HORA = 3_600_000;
const DIA = 24 * HORA;

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
  limparCacheDeFuso();
  await prisma.session.deleteMany({ where: { ingressoSessionId: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function cinema(sufixo: string, ativo = true) {
  return prisma.cinema.create({
    data: {
      ingressoId: `${PREFIXO}-${sufixo}`,
      name: `${PREFIXO} ${sufixo}`,
      timezone: 'America/Sao_Paulo',
      active: ativo,
    },
    select: { id: true },
  });
}

async function titulo(sufixo: string, status: 'matched' | 'orphan' | 'not_a_film' = 'matched') {
  return prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status,
    },
    select: { id: true },
  });
}

let contador = 0;

async function sessao(titleId: string, cinemaId: string, inicio: Date, ativa = true) {
  contador += 1;
  await prisma.session.create({
    data: {
      ingressoSessionId: `${PREFIXO}-${contador}`,
      titleId,
      cinemaId,
      startsAt: inicio,
      roomType: 'normal',
      audio: 'dublado',
      active: ativa,
    },
  });
}

/** Um dia daqui a alguns dias, no fuso da cidade, e a meia-noite local dele. */
async function diaFuturo(emDias: number) {
  const fuso = await fusoDaCidade();
  const dia = diaNoFuso(new Date(Date.now() + emDias * DIA), fuso);
  return { dia, meiaNoite: inicioDoDia(dia, fuso) };
}

describe('programacaoDoDia', () => {
  it('lista o filme do dia com os horários agrupados por cinema', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const { dia, meiaNoite } = await diaFuturo(3);
    const a = await cinema('a');
    const b = await cinema('b');
    const filme = await titulo('-filme');

    await sessao(filme.id, a.id, new Date(meiaNoite.getTime() + 14 * HORA));
    await sessao(filme.id, a.id, new Date(meiaNoite.getTime() + 19 * HORA));
    await sessao(filme.id, b.id, new Date(meiaNoite.getTime() + 21 * HORA));

    const programacao = await programacaoDoDia(dia);
    const achado = programacao.filmes.find((f) => f.id === filme.id);

    expect(programacao.dia).toBe(dia);
    expect(achado?.totalDeSessoes).toBe(3);
    expect(achado?.sessoes.map((c) => c.sessoes.map((s) => s.horario))).toEqual([
      ['14h00', '19h00'],
      ['21h00'],
    ]);
    expect(programacao.cinemas.map((c) => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(programacao.dias.some((d) => d.dia === dia)).toBe(true);
  });

  it('corta o dia no fuso da cidade, não em UTC', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // 23h30 em Campinas já é o dia seguinte em UTC: tem de ficar no dia local
    const { dia, meiaNoite } = await diaFuturo(4);
    const cine = await cinema('fuso');
    const tarde = await titulo('-tarde');
    const madrugada = await titulo('-madrugada');

    await sessao(tarde.id, cine.id, new Date(meiaNoite.getTime() + 23.5 * HORA));
    await sessao(madrugada.id, cine.id, new Date(meiaNoite.getTime() + 24.5 * HORA));

    const programacao = await programacaoDoDia(dia);
    const ids = programacao.filmes.map((f) => f.id);

    expect(ids).toContain(tarde.id);
    expect(ids).not.toContain(madrugada.id);
  });

  it('deixa de fora cinema inativo, sessão inativa e não-filme', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const { dia, meiaNoite } = await diaFuturo(3);
    const ativo = await cinema('ativo');
    const inativo = await cinema('inativo', false);
    const deCinemaInativo = await titulo('-cinema-inativo');
    const desativada = await titulo('-sessao-inativa');
    const opera = await titulo('-opera', 'not_a_film');
    const orfao = await titulo('-orfao', 'orphan');
    const quando = new Date(meiaNoite.getTime() + 20 * HORA);

    await sessao(deCinemaInativo.id, inativo.id, quando);
    await sessao(desativada.id, ativo.id, quando, false);
    await sessao(opera.id, ativo.id, quando);
    await sessao(orfao.id, ativo.id, quando);

    const ids = (await programacaoDoDia(dia)).filmes.map((f) => f.id);

    expect(ids).not.toContain(deCinemaInativo.id);
    expect(ids).not.toContain(desativada.id);
    expect(ids).not.toContain(opera.id);
    // §2: órfão continua aparecendo
    expect(ids).toContain(orfao.id);
  });

  it('hoje mostra só o que ainda não começou', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const fuso = await fusoDaCidade();
    const agora = Date.now();
    const hoje = diaNoFuso(new Date(agora), fuso);
    const cine = await cinema('hoje');
    const comecou = await titulo('-ja-comecou');
    const vaiComecar = await titulo('-vai-comecar');

    await sessao(comecou.id, cine.id, new Date(agora - 60_000));
    // perto da meia-noite "daqui a pouco" pode ser amanhã; aí o teste não diz nada
    const depois = new Date(agora + 60_000);
    await sessao(vaiComecar.id, cine.id, depois);

    const ids = (await programacaoDoDia(hoje)).filmes.map((f) => f.id);

    expect(ids).not.toContain(comecou.id);
    if (diaNoFuso(depois, fuso) === hoje) expect(ids).toContain(vaiComecar.id);
  });

  it('recusa data impossível em vez de virar outro dia', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    await expect(programacaoDoDia('2026-02-31')).rejects.toBeInstanceOf(ValidationError);
    await expect(programacaoDoDia('amanha')).rejects.toBeInstanceOf(ValidationError);
  });
});
