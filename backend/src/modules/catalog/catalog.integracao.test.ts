import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { mergeTitles } from './catalog.merge';
import { aplicarDecisao } from './catalog.service';
import { recalcularTagsDoTitulo } from '../tags/tags.service';
import { sincronizarSessoes } from '../cinemas/cinemas.service';
import type { DecisaoDeMatching, EventoParaMatching } from '../matching/matching.types';

/**
 * Testes de integração do passo 6. Precisam do Postgres.
 *
 * Tudo que estes testes criam leva o prefixo `__teste__`, e o `afterEach`
 * limpa. Nenhum dado real da Carol é tocado.
 */

const PREFIXO = '__teste__';
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
  // ordem importa: filhos antes dos pais onde não há cascade
  await prisma.session.deleteMany({ where: { ingressoSessionId: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
  await prisma.matchDecision.deleteMany({ where: { ingressoEventId: { startsWith: PREFIXO } } });
  await prisma.reviewItem.deleteMany({ where: { ingressoEventId: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  // ⚠️ limpar por `label`, não só por `value`: o `slugificar` come os
  // underscores, então "__teste__Cine B" vira o value "teste-cine-b" e um
  // filtro por prefixo no value deixa lixo no banco da Carol.
  await prisma.tag.deleteMany({
    where: {
      OR: [
        { value: { startsWith: PREFIXO } },
        { label: { startsWith: PREFIXO } },
        { value: 'ultra-screen-9000' },
      ],
    },
  });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function criarTitulo(sufixo: string, extras: Record<string, unknown> = {}) {
  return prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status: 'matched',
      ...extras,
    },
    select: { id: true },
  });
}

async function criarCinema(sufixo: string) {
  return prisma.cinema.create({
    data: { ingressoId: `${PREFIXO}${sufixo}`, name: `${PREFIXO}Cine ${sufixo}` },
    select: { id: true },
  });
}

// ─────────────────────────────────────────────────────────────

describe('aplicarDecisao — §2 "nenhum filme some"', () => {
  const evento: EventoParaMatching = {
    ingressoEventId: `${PREFIXO}evt1`,
    title: `${PREFIXO}Filme Órfão`,
    originalTitle: null,
    year: 2026,
    runtimeMinutes: 100,
    distributor: 'Independente',
    siteUrl: null,
    directorNames: [],
    castNames: [],
  };

  const decisaoOrfa: DecisaoDeMatching = {
    stage: 'threshold',
    outcome: 'no_candidate',
    reviewReason: 'no_candidate',
    reason: 'sem candidato',
    normalizerVersion: 'teste',
    normalizedQuery: 'filme orfao',
  };

  it('evento sem candidato ainda vira Title visível', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await aplicarDecisao(evento, decisaoOrfa);

    const title = await prisma.title.findUnique({ where: { id: r.titleId } });
    expect(title?.status).toBe('orphan');
    expect(title?.title).toBe(evento.title);
  });

  it('e abre pendência na mesma transação', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await aplicarDecisao(evento, decisaoOrfa);

    expect(r.abriuPendencia).toBe(true);
    const item = await prisma.reviewItem.findFirst({
      where: { ingressoEventId: evento.ingressoEventId },
    });
    expect(item?.reason).toBe('no_candidate');
    // a pendência aponta para o Title órfão, para o botão "substituir" saber
    // o que reescrever
    expect(item?.subjectTitleId).toBe(r.titleId);
  });

  it('roda duas vezes sem duplicar Title nem pendência', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const primeira = await aplicarDecisao(evento, decisaoOrfa);
    const segunda = await aplicarDecisao(
      evento,
      { ...decisaoOrfa, titleId: primeira.titleId },
    );

    expect(segunda.titleId).toBe(primeira.titleId);
    const pendencias = await prisma.reviewItem.count({
      where: { ingressoEventId: evento.ingressoEventId, status: 'open' },
    });
    expect(pendencias).toBe(1);
  });

  it('não-filme vira Title com status not_a_film, não some', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await aplicarDecisao(evento, {
      ...decisaoOrfa,
      stage: 'triage',
      outcome: 'not_a_film',
      reviewReason: 'probable_non_film',
    });

    const title = await prisma.title.findUnique({ where: { id: r.titleId } });
    expect(title?.status).toBe('not_a_film');
  });

  it('liga o id do ingresso, que é o cache do estágio 0', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await aplicarDecisao(evento, decisaoOrfa);

    const externo = await prisma.titleExternalId.findUnique({
      where: { source_externalId: { source: 'ingresso', externalId: evento.ingressoEventId } },
    });
    expect(externo?.titleId).toBe(r.titleId);
  });
});

describe('mergeTitles — §7.3', () => {
  it('reponta sessões, ids externos, tags e estado do usuário', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const origem = await criarTitulo('origem');
    const destino = await criarTitulo('destino');
    const cinema = await criarCinema('A');

    await prisma.session.create({
      data: {
        ingressoSessionId: `${PREFIXO}s1`,
        titleId: origem.id,
        cinemaId: cinema.id,
        startsAt: new Date('2026-09-22T20:00:00-03:00'),
        roomType: 'imax',
      },
    });
    await prisma.titleExternalId.create({
      data: { titleId: origem.id, source: 'ingresso', externalId: `${PREFIXO}e1`, method: 'fuzzy' },
    });
    await prisma.userTitleState.create({
      data: { userId: 'catflix', titleId: origem.id, status: 'quero_ver' },
    });
    const tag = await prisma.tag.create({
      data: { facet: 'manual', value: `${PREFIXO}tag`, label: 'Tag da Carol', origin: 'manual', ownerId: 'catflix' },
    });
    await prisma.titleTag.create({ data: { titleId: origem.id, tagId: tag.id, origin: 'manual' } });

    const r = await mergeTitles(origem.id, destino.id, { reason: 'teste' });

    expect(r.repontados.sessions).toBe(1);
    expect(r.repontados.titleExternalId).toBe(1);
    expect(r.repontados.userTitleState).toBe(1);
    expect(r.repontados.titleTag).toBe(1);

    const sessao = await prisma.session.findUnique({ where: { ingressoSessionId: `${PREFIXO}s1` } });
    expect(sessao?.titleId).toBe(destino.id);

    // a tag MANUAL da Carol sobreviveu ao merge
    const tagNoDestino = await prisma.titleTag.findUnique({
      where: { titleId_tagId: { titleId: destino.id, tagId: tag.id } },
    });
    expect(tagNoDestino?.origin).toBe('manual');
  });

  it('grava o TitleAlias, que impede o sync de separar de novo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const origem = await criarTitulo('origem2');
    const destino = await criarTitulo('destino2');

    const r = await mergeTitles(origem.id, destino.id, { reason: 'possible_duplicate' });

    const alias = await prisma.titleAlias.findUnique({ where: { id: r.aliasId } });
    expect(alias?.fromTitleId).toBe(origem.id);
    expect(alias?.toTitleId).toBe(destino.id);
    expect(alias?.reason).toBe('possible_duplicate');
    // o snapshot guarda o que o Title absorvido era, para auditoria
    expect(alias?.snapshot).toMatchObject({ title: `${PREFIXO}origem2` });
  });

  it('o absorvido vira lápide e some do app, sem ser apagado', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const origem = await criarTitulo('origem3');
    const destino = await criarTitulo('destino3');

    await mergeTitles(origem.id, destino.id, { reason: 'teste' });

    const absorvido = await prisma.title.findUnique({ where: { id: origem.id } });
    expect(absorvido).not.toBeNull();
    expect(absorvido?.status).toBe('merged');
  });

  it('resolve colisão de estado sem perder o mais recente', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const origem = await criarTitulo('origem4');
    const destino = await criarTitulo('destino4');

    // a Carol marcou "quero ver" no destino ontem e "visto" na origem hoje
    await prisma.userTitleState.create({
      data: {
        userId: 'catflix',
        titleId: destino.id,
        status: 'quero_ver',
        statusChangedAt: new Date('2026-09-20T12:00:00Z'),
      },
    });
    await prisma.userTitleState.create({
      data: {
        userId: 'catflix',
        titleId: origem.id,
        status: 'visto',
        statusChangedAt: new Date('2026-09-22T12:00:00Z'),
      },
    });

    await mergeTitles(origem.id, destino.id, { reason: 'teste' });

    const estados = await prisma.userTitleState.findMany({ where: { userId: 'catflix', titleId: { in: [origem.id, destino.id] } } });
    expect(estados).toHaveLength(1);
    // "visto" é mais recente e não pode se perder
    expect(estados[0]!.status).toBe('visto');
  });

  it('recusa unir um título com ele mesmo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const t = await criarTitulo('sozinho');
    await expect(mergeTitles(t.id, t.id)).rejects.toThrow();
  });
});

describe('tags automáticas — a regra que não pode ser quebrada', () => {
  it('recalcula as auto a partir das sessões e NÃO toca nas manuais', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const title = await criarTitulo('comtags');
    const cinema = await criarCinema('B');

    await prisma.session.create({
      data: {
        ingressoSessionId: `${PREFIXO}s2`,
        titleId: title.id,
        cinemaId: cinema.id,
        startsAt: new Date('2026-09-22T20:00:00-03:00'),
        roomType: 'imax',
        roomLabel: 'IMAX',
        audio: 'legendado',
        active: true,
      },
    });

    const manual = await prisma.tag.create({
      data: { facet: 'manual', value: `${PREFIXO}favorito`, label: 'Favorito', origin: 'manual', ownerId: 'catflix' },
    });
    await prisma.titleTag.create({ data: { titleId: title.id, tagId: manual.id, origin: 'manual' } });

    await recalcularTagsDoTitulo(title.id);
    // duas vezes: recalcular é idempotente e a manual segue de pé
    await recalcularTagsDoTitulo(title.id);

    const ligacoes = await prisma.titleTag.findMany({
      where: { titleId: title.id },
      include: { tag: true },
    });

    const facetas = ligacoes.map((l) => `${l.tag.facet}:${l.tag.value}`);
    expect(facetas).toContain('sala:imax');
    expect(facetas).toContain('audio:legendado');
    expect(facetas).toContain(`manual:${PREFIXO}favorito`);

    const aManual = ligacoes.find((l) => l.tag.id === manual.id);
    expect(aManual?.origin).toBe('manual');
  });

  it('sessão desativada deixa de gerar tag', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const title = await criarTitulo('semsessao');
    const cinema = await criarCinema('C');

    await prisma.session.create({
      data: {
        ingressoSessionId: `${PREFIXO}s3`,
        titleId: title.id,
        cinemaId: cinema.id,
        startsAt: new Date('2026-09-22T20:00:00-03:00'),
        roomType: 'xd',
        active: false,
      },
    });

    await recalcularTagsDoTitulo(title.id);

    const ligacoes = await prisma.titleTag.count({ where: { titleId: title.id } });
    expect(ligacoes).toBe(0);
  });
});

describe('sessões — nada é apagado', () => {
  it('sessão que sumiu da API vira inativa, não some', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const title = await criarTitulo('comsessao');
    const cinema = await criarCinema('D');
    const mapa = new Map([[`${PREFIXO}evt`, title.id]]);

    const sessao = {
      ingressoSessionId: `${PREFIXO}s4`,
      theaterIngressoId: `${PREFIXO}D`,
      eventIngressoId: `${PREFIXO}evt`,
      startsAt: new Date('2026-09-22T20:00:00-03:00'),
      roomType: 'imax',
      roomLabel: 'IMAX',
      roomName: 'Sala 7',
      audio: 'legendado' as const,
      is3d: false,
      sessionKind: 'regular' as const,
      purchaseUrl: null,
      enabled: true,
    };

    await sincronizarSessoes(`${PREFIXO}D`, [sessao], mapa);
    expect(await prisma.session.count({ where: { cinemaId: cinema.id, active: true } })).toBe(1);

    // próximo sync: a sessão não vem mais
    const r = await sincronizarSessoes(`${PREFIXO}D`, [], mapa);

    expect(r.desativadas).toBe(1);
    const aindaExiste = await prisma.session.findUnique({
      where: { ingressoSessionId: `${PREFIXO}s4` },
    });
    expect(aindaExiste).not.toBeNull();
    expect(aindaExiste?.active).toBe(false);
  });

  it('sessão sem Title é pulada, nunca ligada ao Title errado', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    await criarCinema('E');

    const r = await sincronizarSessoes(
      `${PREFIXO}E`,
      [
        {
          ingressoSessionId: `${PREFIXO}s5`,
          theaterIngressoId: `${PREFIXO}E`,
          eventIngressoId: 'evento-sem-title',
          startsAt: new Date(),
          roomType: 'normal',
          roomLabel: null,
          roomName: null,
          audio: 'dublado',
          is3d: false,
          sessionKind: 'regular',
          purchaseUrl: null,
          enabled: true,
        },
      ],
      new Map(),
    );

    expect(r.semTitle).toBe(1);
    expect(r.gravadas).toBe(0);
  });
});

describe('rótulo de tag de sala — regressão do painel de facetas', () => {
  it('a tag do formato usa o rótulo DO FORMATO, não o da sessão inteira', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const title = await criarTitulo('rotulo');
    const cinema = await criarCinema('F');

    // sessão que é XD e D-Box ao mesmo tempo: roomType fica "xd" e
    // roomLabel fica "XD · D-Box"
    await prisma.session.create({
      data: {
        ingressoSessionId: `${PREFIXO}s6`,
        titleId: title.id,
        cinemaId: cinema.id,
        startsAt: new Date('2026-09-22T20:00:00-03:00'),
        roomType: 'xd',
        roomLabel: 'XD · D-Box',
        audio: 'dublado',
        active: true,
      },
    });

    await recalcularTagsDoTitulo(title.id);

    const tagDeSala = await prisma.tag.findFirst({ where: { facet: 'sala', value: 'xd' } });
    // o painel mostrava "XD · D-Box" como se fosse um formato só
    expect(tagDeSala?.label).toBe('XD');
  });

  it('formato que o ingresso ainda não inventou ganha rótulo legível', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const title = await criarTitulo('rotulonovo');
    const cinema = await criarCinema('G');

    await prisma.session.create({
      data: {
        ingressoSessionId: `${PREFIXO}s7`,
        titleId: title.id,
        cinemaId: cinema.id,
        startsAt: new Date('2026-09-22T20:00:00-03:00'),
        roomType: 'ultra-screen-9000',
        audio: 'dublado',
        active: true,
      },
    });

    await recalcularTagsDoTitulo(title.id);

    const tag = await prisma.tag.findFirst({ where: { facet: 'sala', value: 'ultra-screen-9000' } });
    expect(tag?.label).toBe('Ultra Screen 9000');
  });
});
