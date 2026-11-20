import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import { conteudoDoLembrete, enviarLembretesPendentes } from './tickets.lembrete';
import {
  cadastrarIngresso,
  editarIngresso,
  ingressosAtivos,
  ingressosDoTitulo,
  limparCodigos,
  marcarComoAssistido,
  removerIngresso,
} from './tickets.service';

/** Ingresso comprado e o lembrete de 30 minutos, contra o banco de desenvolvimento. */

const PREFIXO = '__teste__ingresso';
const MINUTO = 60_000;

/** O envio de mentira: guarda o que sairia, sem falar com serviço de push. */
const enviados: Array<{ perfis: string[]; title: string; body: string }> = [];
const enviarDeMentira = async (perfis: string[], conteudo: { title: string; body: string }) => {
  enviados.push({ perfis, title: conteudo.title, body: conteudo.body });
  return { enviados: perfis.length, expirados: 0, falhas: 0, semInscricao: false };
};
const falharSempre = async () => ({ enviados: 0, expirados: 0, falhas: 1, semInscricao: false });

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
  enviados.length = 0;
  if (!temBanco) return;
  // ingressos e sessões caem em cascata com o Title; o cinema vai à parte
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function filmeComSessoes(sufixo: string, inicios: Date[]) {
  const titulo = await prisma.title.create({
    data: { title: `${PREFIXO}${sufixo}`, normalizedTitle: `${PREFIXO}${sufixo}`, status: 'matched' },
    select: { id: true },
  });
  const cinema = await prisma.cinema.create({
    data: { ingressoId: `${PREFIXO}${sufixo}`, name: 'Cinema de Teste' },
    select: { id: true },
  });
  const sessoes = [];
  for (const [i, startsAt] of inicios.entries()) {
    sessoes.push(
      await prisma.session.create({
        data: {
          ingressoSessionId: `${PREFIXO}${sufixo}-${i}`,
          titleId: titulo.id,
          cinemaId: cinema.id,
          startsAt,
          roomType: 'imax',
          roomName: 'Sala 7',
          audio: 'legendado',
        },
        select: { id: true },
      }),
    );
  }
  return { titleId: titulo.id, sessoes };
}

describe('códigos de resgate', () => {
  it('apara, descarta vazios e repetidos e mantém a ordem', () => {
    expect(limparCodigos([' ABC123 ', '', 'DEF456', 'ABC123', '   '])).toEqual(['ABC123', 'DEF456']);
  });

  it('recusa código longo demais e códigos demais', () => {
    expect(() => limparCodigos(['x'.repeat(121)])).toThrow(ValidationError);
    expect(() => limparCodigos(Array.from({ length: 11 }, (_, i) => `C${i}`))).toThrow(ValidationError);
  });
});

describe('ingresso comprado', () => {
  it('cadastra com a cópia da sessão, lista e remove', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-cadastra', [new Date(agora.getTime() + 3 * 60 * MINUTO)]);

    const ingresso = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['ABC123', 'DEF456'] });
    expect(ingresso.cinema).toBe('Cinema de Teste');
    expect(ingresso.detalhes).toBe('Sala 7 · IMAX · Legendado');
    expect(ingresso.codigos).toEqual(['ABC123', 'DEF456']);
    expect(ingresso.horario).toMatch(/^\d{2}h\d{2}$/);

    expect((await ingressosDoTitulo(titleId)).map((i) => i.id)).toEqual([ingresso.id]);

    await removerIngresso(ingresso.id);
    expect(await ingressosDoTitulo(titleId)).toEqual([]);
  });

  it('um ingresso por sessão; sessão que já começou não entra', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-unico', [
      new Date(agora.getTime() + 60 * MINUTO),
      new Date(agora.getTime() - 5 * MINUTO),
    ]);

    await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['A'] });
    await expect(cadastrarIngresso(titleId, 'BEAR', { sessaoId: sessoes[0]!.id, codigos: ['B'] })).rejects.toThrow(
      ConflictError,
    );
    await expect(cadastrarIngresso(titleId, 'BEAR', { sessaoId: sessoes[1]!.id, codigos: ['B'] })).rejects.toThrow(
      'já começou',
    );
  });

  it('trocar de sessão rearma o lembrete; trocar só o código, não', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-troca', [
      new Date(agora.getTime() + 20 * MINUTO),
      new Date(agora.getTime() + 5 * 60 * MINUTO),
    ]);

    const ingresso = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['A'] });
    expect(await enviarLembretesPendentes(agora, enviarDeMentira)).toBeGreaterThanOrEqual(1);

    const soCodigo = await editarIngresso(ingresso.id, { codigos: ['A', 'B'] });
    expect(soCodigo.lembreteEnviadoEm).not.toBeNull();

    const outraSessao = await editarIngresso(ingresso.id, { sessaoId: sessoes[1]!.id });
    expect(outraSessao.lembreteEnviadoEm).toBeNull();
    expect(outraSessao.codigos).toEqual(['A', 'B']);
  });
});

describe('lembrete', () => {
  it('sai só dentro dos 30 minutos, uma vez, e nunca depois do começo', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-janela', [
      new Date(agora.getTime() + 25 * MINUTO),
      new Date(agora.getTime() + 45 * MINUTO),
    ]);

    const dentro = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['A'] });
    const fora = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[1]!.id, codigos: ['B'] });

    await enviarLembretesPendentes(agora, enviarDeMentira);
    const meu = enviados.filter((e) => e.body.includes('Código: A'));
    expect(meu).toHaveLength(1);
    // as duas contas do casal
    expect([...meu[0]!.perfis].sort()).toEqual(['catflix', 'hburso']);
    expect(meu[0]!.title).toMatch(/começa em 25 min$/);
    const depois = await prisma.ticket.findMany({ where: { titleId }, select: { id: true, reminderSentAt: true } });
    expect(depois.find((t) => t.id === dentro.id)?.reminderSentAt).not.toBeNull();
    expect(depois.find((t) => t.id === fora.id)?.reminderSentAt).toBeNull();

    // a segunda rodada não manda de novo o que já saiu
    const segunda = await prisma.ticket.findUnique({ where: { id: dentro.id }, select: { reminderSentAt: true } });
    await enviarLembretesPendentes(new Date(agora.getTime() + MINUTO), enviarDeMentira);
    expect((await prisma.ticket.findUnique({ where: { id: dentro.id }, select: { reminderSentAt: true } }))?.reminderSentAt).toEqual(
      segunda?.reminderSentAt,
    );

    // sessão que já começou não recebe lembrete atrasado
    const depoisDoInicio = new Date(agora.getTime() + 50 * MINUTO);
    await enviarLembretesPendentes(depoisDoInicio, enviarDeMentira);
    expect((await prisma.ticket.findUnique({ where: { id: fora.id }, select: { reminderSentAt: true } }))?.reminderSentAt).toBeNull();
  });

  it('falha no envio devolve o lembrete para a próxima rodada', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-falha', [new Date(agora.getTime() + 10 * MINUTO)]);
    const ingresso = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['A'] });

    await enviarLembretesPendentes(agora, falharSempre);
    expect((await prisma.ticket.findUnique({ where: { id: ingresso.id } }))?.reminderSentAt).toBeNull();

    await enviarLembretesPendentes(new Date(agora.getTime() + MINUTO), enviarDeMentira);
    expect((await prisma.ticket.findUnique({ where: { id: ingresso.id } }))?.reminderSentAt).not.toBeNull();
  });

  it('o texto leva filme, minutos, sessão e códigos', () => {
    const agora = new Date('2026-11-20T21:00:00Z');
    const conteudo = conteudoDoLembrete(
      {
        id: 'x',
        titleId: 't',
        startsAt: new Date('2026-11-20T21:30:00Z'),
        cinema: 'Cinemark',
        horario: '18h30',
        detalhes: 'Sala 7 · IMAX',
        codigos: ['ABC', 'DEF'],
      },
      'Pecadores',
      agora,
    );
    expect(conteudo.title).toBe('🎟️ Pecadores começa em 30 min');
    expect(conteudo.body).toBe('18h30 · Cinemark · Sala 7 · IMAX\nCódigos: ABC · DEF');
    expect(conteudo.url).toBe('/filme/t');
  });
});

describe('marcar como assistido', () => {
  it('registra os dois, no cinema, no dia da sessão, e tira o ingresso do carrossel', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-assistido', [new Date(agora.getTime() + 60 * MINUTO)]);
    const ingresso = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: ['A'] });
    expect(ingresso.filme.titulo).toBe(`${PREFIXO}-assistido`);
    expect((await ingressosAtivos()).map((i) => i.id)).toContain(ingresso.id);

    // a sessão já passou (o filme acabou)
    const inicio = new Date(agora.getTime() - 3 * 60 * MINUTO);
    await prisma.ticket.update({ where: { id: ingresso.id }, data: { startsAt: inicio } });
    await prisma.watchlistEntry.create({ data: { titleId, pessoa: 'BEAR' } });

    const r = await marcarComoAssistido(ingresso.id);
    expect(r.visualizacao.local).toBe('CINEMA');
    expect([...r.visualizacao.participantes].sort()).toEqual(['BEAR', 'CAT']);
    expect(r.removidosDaLista.map((x) => x.pessoa)).toEqual(['BEAR']);

    const watch = await prisma.watch.findUniqueOrThrow({ where: { id: r.visualizacao.id } });
    const cinema = await prisma.cinema.findFirstOrThrow({ where: { ingressoId: `${PREFIXO}-assistido` } });
    expect(watch.cinemaId).toBe(cinema.id);
    expect(watch.roomType).toBe('IMAX');
    const diaDaSessao = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(inicio);
    expect(watch.watchedOn.toISOString().slice(0, 10)).toBe(diaDaSessao);

    expect((await ingressosAtivos()).map((i) => i.id)).not.toContain(ingresso.id);
    expect(await ingressosDoTitulo(titleId)).toEqual([]);
    await expect(marcarComoAssistido(ingresso.id)).rejects.toThrow(ConflictError);

    // apagar a visualização devolve o ingresso, que pode ser marcado de novo
    await prisma.watch.update({ where: { id: watch.id }, data: { removedAt: new Date() } });
    expect((await ingressosAtivos()).map((i) => i.id)).toContain(ingresso.id);
  });

  it('não marca sessão de um dia que ainda não chegou', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const agora = new Date();
    const { titleId, sessoes } = await filmeComSessoes('-futuro', [new Date(agora.getTime() + 3 * 24 * 60 * MINUTO)]);
    const ingresso = await cadastrarIngresso(titleId, 'CAT', { sessaoId: sessoes[0]!.id, codigos: [] });
    await expect(marcarComoAssistido(ingresso.id)).rejects.toThrow(ValidationError);
  });
});
