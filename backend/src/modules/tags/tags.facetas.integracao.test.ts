import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { listarTitulos } from '../catalog/catalog.queries';
import { listarFacetas } from './tags.service';

/**
 * Passo 10, painel de tags.
 *
 * O que estes testes protegem é **uma promessa só**: o número que o painel
 * mostra ao lado de uma tag é a quantidade de cards que aparece ao clicar
 * nela. É a única coisa que o painel afirma, e era falsa antes de 24/09/2026 —
 * a contagem incluía títulos `not_a_film`, que a lista nunca mostra, então
 * "IMAX 6" entregava 4 filmes.
 *
 * Rodam contra o banco de desenvolvimento, que tem dado real de Campinas. Por
 * isso nenhuma asserção fala de número absoluto: comparam as duas consultas
 * entre si, que é exatamente o acordo que pode quebrar.
 */

const PREFIXO = '__teste__facetas';

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
  await prisma.titleTag.deleteMany({ where: { tag: { value: { startsWith: PREFIXO } } } });
  await prisma.tag.deleteMany({ where: { value: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string, status: 'matched' | 'orphan' | 'not_a_film' | 'merged') {
  return prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status,
    },
    select: { id: true },
  });
}

/** Cria uma tag de sala e pendura nela os títulos passados. */
async function tagCom(valor: string, titleIds: string[]) {
  const tag = await prisma.tag.create({
    data: { facet: 'sala', value: `${PREFIXO}-${valor}`, label: `Teste ${valor}`, origin: 'auto' },
    select: { id: true, value: true },
  });

  await prisma.titleTag.createMany({
    data: titleIds.map((titleId) => ({ titleId, tagId: tag.id, origin: 'auto' as const })),
  });

  return tag;
}

describe('listarFacetas', () => {
  it('conta só o que a lista mostra — não-filme e merge não entram', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const visiveis = [await titulo('-ok', 'matched'), await titulo('-orfao', 'orphan')];
    const escondidos = [await titulo('-opera', 'not_a_film'), await titulo('-lapide', 'merged')];

    const tag = await tagCom('sala-a', [...visiveis, ...escondidos].map((t) => t.id));

    const faceta = (await listarFacetas()).find((f) => f.value === tag.value);

    expect(faceta).toBeDefined();
    // os quatro têm a tag no banco; só dois são filme que se vê
    expect(faceta?.titulos).toBe(2);
  });

  it('a contagem de cada faceta é o total que a lista devolve com aquela tag', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    // dado real de Campinas: o que pega uma divergência é justamente não
    // montar o cenário à mão
    const facetas = await listarFacetas();
    expect(facetas.length).toBeGreaterThan(0);

    for (const faceta of facetas) {
      // limite alto de propósito: o corte padrão de 200 é paginação da lista,
      // não desacordo de contagem, e faria este teste acusar o que não é
      const lista = await listarTitulos({
        tags: [{ facet: faceta.facet, value: faceta.value }],
        limite: 10_000,
      });

      expect(
        lista.length,
        `faceta ${faceta.facet}:${faceta.value} promete ${faceta.titulos} e a lista devolve ${lista.length}`,
      ).toBe(faceta.titulos);
    }
  });

  it('o filtro qualificado por faceta não casa a mesma palavra em outra faceta', async ({
    skip,
  }) => {
    if (!temBanco) skip('sem Postgres');

    // o caso do passo 11: uma tag manual homônima de uma sala
    const daSala = await titulo('-da-sala', 'matched');
    const daManual = await titulo('-da-manual', 'matched');

    const sala = await tagCom('imax', [daSala.id]);

    const manual = await prisma.tag.create({
      data: { facet: 'manual', value: sala.value, label: 'IMAX', origin: 'manual' },
      select: { id: true },
    });
    await prisma.titleTag.create({
      data: { titleId: daManual.id, tagId: manual.id, origin: 'manual' },
    });

    const qualificado = await listarTitulos({ tags: [{ facet: 'sala', value: sala.value }] });
    const solto = await listarTitulos({ tags: [{ value: sala.value }] });

    expect(qualificado.map((t) => t.id)).toEqual([daSala.id]);
    // sem a faceta, o mesmo slug alcança as duas tags — é por isso que o
    // painel manda `sala:imax` e não `imax`
    expect(solto.map((t) => t.id).sort()).toEqual([daSala.id, daManual.id].sort());
  });
});
