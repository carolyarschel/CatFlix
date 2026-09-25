import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { contarFila, dispensar, listarFila, marcarComoNaoFilme, mesclar } from './review.service';

/**
 * Passo 9. Os testes que tocam o TMDB (confirmar/substituir) ficam de fora
 * daqui de propósito: dependem de rede e já há cobertura do `upsertPorTmdbId`
 * e do `mergeTitles`, que são as duas peças que eles orquestram. O que estes
 * testes protegem é o que NÃO dá para ver de outro jeito — que a resolução
 * sobrevive ao próximo sync.
 */

const PREFIXO = '__teste__rev';
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
  await prisma.reviewItem.deleteMany({ where: { ingressoEventId: { startsWith: PREFIXO } } });
  await prisma.titleExternalId.deleteMany({ where: { externalId: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function cenario(sufixo: string, extras: Record<string, unknown> = {}) {
  const orfao = await prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status: 'orphan',
    },
    select: { id: true },
  });

  await prisma.titleExternalId.create({
    data: {
      titleId: orfao.id,
      source: 'ingresso',
      externalId: `${PREFIXO}${sufixo}`,
      method: 'fuzzy',
    },
  });

  const item = await prisma.reviewItem.create({
    data: {
      ingressoEventId: `${PREFIXO}${sufixo}`,
      ingressoTitle: `${PREFIXO}${sufixo}`,
      ingressoYear: 2026,
      ingressoPayload: { runtimeMinutes: 110, distributor: 'Paris Filmes' },
      subjectTitleId: orfao.id,
      reason: 'low_confidence',
      score: 0.8,
      ...extras,
    },
    select: { id: true },
  });

  return { orfaoId: orfao.id, itemId: item.id };
}

describe('a fila e a badge (§2 e §10)', () => {
  it('lista os itens abertos com o que a tela precisa', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await cenario('a', { candidateLabel: 'Candidato X', candidateTmdbId: 999001 });

    const fila = await listarFila();
    const meu = fila.itens.find((i) => i.eventoTitulo === `${PREFIXO}a`);

    expect(meu).toBeDefined();
    // os campos que o modelo de design pede
    expect(meu!.eventoMeta).toContain('2026');
    expect(meu!.eventoMeta).toContain('110 min');
    expect(meu!.temCandidato).toBe(true);
    expect(meu!.candidatoTitulo).toBe('Candidato X');
  });

  it('marca temCandidato como falso quando não há sugestão', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await cenario('b', { reason: 'no_candidate' });

    const fila = await listarFila();
    const meu = fila.itens.find((i) => i.eventoTitulo === `${PREFIXO}b`);
    expect(meu!.temCandidato).toBe(false);
    expect(meu!.candidatoTitulo).toBeNull();
  });

  it('traz a contagem por motivo, para as pills de filtro', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await cenario('c', { reason: 'no_candidate' });

    const fila = await listarFila();
    expect(fila.porMotivo.some((m) => m.motivo === 'no_candidate')).toBe(true);
    expect(fila.total).toBe(fila.porMotivo.reduce((s, m) => s + m.quantidade, 0));
  });

  it('filtra por motivo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await cenario('d', { reason: 'probable_non_film' });

    const fila = await listarFila({ motivo: 'probable_non_film' });
    expect(fila.itens.every((i) => i.motivo === 'probable_non_film')).toBe(true);
  });

  it('a contagem da badge bate com o total da fila', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    await cenario('e');

    expect(await contarFila()).toBe((await listarFila()).total);
  });
});

describe('resolver tem de sobreviver ao próximo sync', () => {
  it('merge reaponta o id do ingresso para o Title de destino', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const { orfaoId, itemId } = await cenario('merge');
    const destino = await prisma.title.create({
      data: {
        title: `${PREFIXO}destino`,
        normalizedTitle: `${PREFIXO}destino`.toLowerCase(),
        status: 'matched',
      },
      select: { id: true },
    });

    await mesclar(itemId, destino.id, 'catflix');

    // ⚠️ O PONTO: o TitleExternalId é o cache do estágio 0 do matching. Se ele
    // continuasse no órfão, o sync das 6h restauraria a decisão velha e o
    // trabalho da Carol sumiria.
    const externo = await prisma.titleExternalId.findUnique({
      where: { source_externalId: { source: 'ingresso', externalId: `${PREFIXO}merge` } },
    });
    expect(externo?.titleId).toBe(destino.id);
    expect(externo?.method).toBe('manual');

    // e o merge deixou o alias que impede a separação futura (§7.3)
    const alias = await prisma.titleAlias.findFirst({
      where: { fromTitleId: orfaoId, toTitleId: destino.id },
    });
    expect(alias).not.toBeNull();

    await prisma.titleAlias.deleteMany({ where: { toTitleId: destino.id } });
    await prisma.title.deleteMany({ where: { id: { in: [orfaoId, destino.id] } } });
  });

  it('não-filme marca o Title, que continua existindo', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const { orfaoId, itemId } = await cenario('naofilme');

    const r = await marcarComoNaoFilme(itemId, 'catflix');

    expect(r.resolution).toBe('marked_not_a_film');
    const title = await prisma.title.findUnique({ where: { id: orfaoId } });
    // §2 "nenhum filme some": ele deixa as trilhas, não o banco
    expect(title).not.toBeNull();
    expect(title?.status).toBe('not_a_film');
  });

  it('dispensar fecha a pendência e deixa o título órfão de propósito', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const { orfaoId, itemId } = await cenario('dispensa');

    await dispensar(itemId, 'catflix');

    const item = await prisma.reviewItem.findUnique({ where: { id: itemId } });
    expect(item?.status).toBe('resolved');
    expect(item?.resolution).toBe('dismissed');
    expect(item?.resolvedById).toBe('catflix');

    // o filme existe e continua visível; só não tem metadata
    const title = await prisma.title.findUnique({ where: { id: orfaoId } });
    expect(title?.status).toBe('orphan');
  });

  it('resolver duas vezes é recusado, não repetido', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const { itemId } = await cenario('duplo');

    await dispensar(itemId, 'catflix');
    // dois cliques no botão, ou dois perfis abrindo a fila ao mesmo tempo
    await expect(dispensar(itemId, 'hburso')).rejects.toThrow(/já foi resolvida/);
  });

  it('item resolvido sai da fila e da badge', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();
    const { itemId } = await cenario('sai');

    const antes = await contarFila();
    await dispensar(itemId, 'catflix');

    expect(await contarFila()).toBe(antes - 1);
    expect((await listarFila()).itens.some((i) => i.id === itemId)).toBe(false);
  });
});
