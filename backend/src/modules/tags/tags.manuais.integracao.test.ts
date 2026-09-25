import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { listarTitulos } from '../catalog/catalog.queries';
import {
  adicionarTagManual,
  recalcularTagsDoTitulo,
  removerTagManual,
  tagsManuaisDe,
} from './tags.service';

/**
 * Passo 11 — tags manuais.
 *
 * O teste central é um só: **o sync não pode tocar numa tag manual**. O §6 diz
 * isso em uma linha, e é a linha mais fácil de quebrar sem perceber, porque
 * todo o recálculo de tags do sync é `deleteMany` seguido de `create`. Se um
 * `deleteMany` perder o filtro `origin: 'auto'`, o trabalho das duas pessoas
 * some e nenhum outro teste acusa.
 */

const PREFIXO = '__teste__manual';

/**
 * Marcador do TEXTO das tags, separado do prefixo dos títulos.
 *
 * Precisa ser próprio porque o `value` de uma tag manual é o slug do que a
 * pessoa digitou, não do nome do teste: limpar por `value: startsWith(PREFIXO)`
 * não pegava nada, e as tags do teste ficavam no banco de desenvolvimento —
 * apareciam depois em `GET /tags/minhas` como se a Carol as tivesse escrito.
 * Achado em 24/09/2026, com três tags órfãs no banco.
 */
const MARCADOR = 'zzteste';

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
  await prisma.titleTag.deleteMany({ where: { title: { title: { startsWith: PREFIXO } } } });
  // as auto, pelo slug; as manuais, pelo rótulo — é o que o teste controla
  await prisma.tag.deleteMany({ where: { value: { startsWith: PREFIXO } } });
  // `mode: 'insensitive'` porque um dos testes grava o marcador em caixa alta
  await prisma.tag.deleteMany({
    where: { facet: 'manual', label: { startsWith: MARCADOR, mode: 'insensitive' } },
  });
  await prisma.session.deleteMany({ where: { ingressoSessionId: { startsWith: PREFIXO } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
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

/** Um cinema e uma sessão IMAX, que é o que faz o sync gerar tags `auto`. */
async function comSessaoImax(titleId: string) {
  const cinema = await prisma.cinema.create({
    data: {
      ingressoId: `${PREFIXO}-cine`,
      name: `${PREFIXO} Cine`,
      timezone: 'America/Sao_Paulo',
    },
    select: { id: true },
  });

  await prisma.session.create({
    data: {
      ingressoSessionId: `${PREFIXO}-sessao`,
      titleId,
      cinemaId: cinema.id,
      startsAt: new Date(Date.now() + 86_400_000),
      roomType: 'imax',
      audio: 'legendado',
      sessionKind: 'regular',
      active: true,
    },
  });
}

async function tagsDoTitulo(titleId: string) {
  const linhas = await prisma.titleTag.findMany({
    where: { titleId },
    select: { origin: true, tag: { select: { value: true, label: true, ownerId: true } } },
  });
  return linhas.map((l) => ({ origem: l.origin, ...l.tag }));
}

describe('tags manuais', () => {
  it('o recálculo do sync NÃO apaga tag manual — §6', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-sobrevive');
    await comSessaoImax(t.id);

    await adicionarTagManual(t.id, 'catflix', `${MARCADOR} maratona`);
    // o sync roda: derruba as auto e recria a partir das sessões
    await recalcularTagsDoTitulo(t.id);

    const tags = await tagsDoTitulo(t.id);
    const manual = tags.find((x) => x.origem === 'manual');

    expect(manual, 'a tag manual sumiu no recálculo do sync').toBeDefined();
    expect(manual?.label).toBe(`${MARCADOR} maratona`);
    // e as automáticas continuam sendo geradas normalmente
    expect(tags.some((x) => x.origem === 'auto' && x.value === 'imax')).toBe(true);
  });

  it('a tag é de quem escreveu: o outro perfil não consegue tirá-la', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-dono');
    const tag = await adicionarTagManual(t.id, 'catflix', `${MARCADOR} maratona`);

    await expect(removerTagManual(t.id, tag.id, 'hburso')).rejects.toThrow(/outro perfil/i);
    expect(await tagsDoTitulo(t.id)).toHaveLength(1);

    await removerTagManual(t.id, tag.id, 'catflix');
    expect(await tagsDoTitulo(t.id)).toHaveLength(0);
  });

  it('os dois podem ter a mesma palavra sem uma virar a do outro', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-mesma-palavra');
    const dela = await adicionarTagManual(t.id, 'catflix', `${MARCADOR} Maratona`);
    const dele = await adicionarTagManual(t.id, 'hburso', `${MARCADOR} maratona`);

    expect(dela.id).not.toBe(dele.id);
    expect(dela.value).toBe(dele.value);
    expect(await tagsDoTitulo(t.id)).toHaveLength(2);
  });

  it('a mesma tag duas vezes no mesmo filme não duplica', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-repetida');
    await adicionarTagManual(t.id, 'catflix', `${MARCADOR} maratona`);
    await adicionarTagManual(t.id, 'catflix', `  ${MARCADOR.toUpperCase()} MARATONA  `);

    const tags = await tagsDoTitulo(t.id);
    expect(tags).toHaveLength(1);
    // o rótulo acompanha a última grafia; o slug é que identifica
    expect(tags[0]?.label).toBe(`${MARCADOR.toUpperCase()} MARATONA`);
  });

  it('a rota de remoção recusa tag automática — ela voltaria no sync', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-auto');
    await comSessaoImax(t.id);
    await recalcularTagsDoTitulo(t.id);

    const auto = await prisma.titleTag.findFirst({
      where: { titleId: t.id, origin: 'auto' },
      select: { tagId: true },
    });

    await expect(removerTagManual(t.id, auto!.tagId, 'catflix')).rejects.toThrow(/automática/i);
  });

  it('texto sem letra nem número é recusado, não vira slug vazio', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-vazia');
    await expect(adicionarTagManual(t.id, 'catflix', '???')).rejects.toThrow(/letra ou número/i);
    await expect(adicionarTagManual(t.id, 'catflix', '   ')).rejects.toThrow(/nome/i);
  });

  it('a tag manual filtra a lista e sobrevive à remoção do vínculo', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const t = await titulo('-filtra');
    const tag = await adicionarTagManual(t.id, 'catflix', `${MARCADOR} sessão da madrugada`);

    const achados = await listarTitulos({ tags: [{ facet: 'manual', value: tag.value }] });
    expect(achados.map((x) => x.id)).toContain(t.id);

    await removerTagManual(t.id, tag.id, 'catflix');

    // o vínculo some, mas o vocabulário da pessoa fica
    expect(await listarTitulos({ tags: [{ facet: 'manual', value: tag.value }] })).toHaveLength(0);
    expect((await tagsManuaisDe('catflix')).map((x) => x.value)).toContain(tag.value);
  });
});
