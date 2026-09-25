import { Prisma } from '@prisma/client';
import type { TagFacet } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { slugificar } from '../ingresso';
// Do arquivo, e não do barril `../catalog`: o barril exporta as rotas, e não há
// motivo para o módulo de tags arrastar um Router junto de uma constante.
import { STATUS_VISIVEIS } from '../catalog/catalog.queries';
import roomConfig from '../../config/room-types.json';

const log = logger.child({ module: 'tags' });

/**
 * Facetas automáticas (§1 e §6): cinema, tipo de sala e áudio, derivadas das
 * sessões.
 *
 * ⚠️ **A regra que não pode ser quebrada:** tags `auto` são recalculadas a cada
 * sync; tags `manual` o sync NUNCA toca. As manuais são trabalho da Carol e do
 * namorado dela — perder uma porque um filme mudou de sala seria imperdoável.
 * Por isso todo `deleteMany` daqui filtra por `origin: 'auto'`.
 */

interface TagDesejada {
  facet: TagFacet;
  value: string;
  label: string;
}

/**
 * Encontra ou cria uma tag automática.
 *
 * Precisa de SQL cru por causa do índice parcial `tags_unique_auto`: no
 * Postgres, `NULL` é distinto de `NULL` em índice único, então o
 * `@@unique([facet, value, ownerId])` do Prisma NÃO impede duas tags auto
 * iguais — e o `upsert` do Prisma não sabe mirar um índice parcial.
 */
async function garantirTagAuto(
  tx: Prisma.TransactionClient,
  tag: TagDesejada,
): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO tags (id, facet, value, label, origin, owner_id, created_at)
    VALUES (
      gen_random_uuid()::text,
      ${tag.facet}::"TagFacet",
      ${tag.value},
      ${tag.label},
      'auto'::"TagOrigin",
      NULL,
      now()
    )
    ON CONFLICT (facet, value) WHERE owner_id IS NULL
    DO UPDATE SET label = EXCLUDED.label
    RETURNING id
  `;

  return linhas[0]!.id;
}

/**
 * Deriva as tags de um título a partir das sessões ATIVAS dele.
 *
 * Sessão desativada não gera tag: um filme que saiu do IMAX não deve continuar
 * aparecendo no filtro de IMAX.
 */
async function tagsDerivadasDasSessoes(
  tx: Prisma.TransactionClient,
  titleId: string,
): Promise<TagDesejada[]> {
  const sessoes = await tx.session.findMany({
    where: { titleId, active: true },
    select: {
      roomType: true,
      roomLabel: true,
      audio: true,
      is3d: true,
      cinema: { select: { name: true, chain: true } },
    },
  });

  const desejadas = new Map<string, TagDesejada>();
  const juntar = (tag: TagDesejada) => desejadas.set(`${tag.facet}:${tag.value}`, tag);

  for (const sessao of sessoes) {
    // faceta CINEMA
    juntar({
      facet: 'cinema',
      value: slugificar(sessao.cinema.name),
      label: sessao.cinema.name,
    });

    // faceta SALA — "normal" não é filtro útil: não distingue nada
    if (sessao.roomType && sessao.roomType !== 'normal') {
      // ⚠️ o rótulo vem do TIPO, não do `roomLabel` da sessão. Uma sessão
      // "XD · D-Box" tem roomType "xd", e usar o rótulo dela fazia o painel de
      // tags mostrar "XD · D-Box" como se fosse um formato só.
      juntar({ facet: 'sala', value: sessao.roomType, label: rotuloDeSala(sessao.roomType) });
    }

    if (sessao.is3d) {
      juntar({ facet: 'sala', value: '3d', label: '3D' });
    }

    // faceta ÁUDIO — "desconhecido" não vira filtro
    if (sessao.audio !== 'desconhecido') {
      juntar({ facet: 'audio', value: sessao.audio, label: rotuloDeAudio(sessao.audio) });
    }
  }

  return [...desejadas.values()];
}

/** Rótulo de exibição de um formato de sala; slug desconhecido vira Title Case. */
function rotuloDeSala(slug: string): string {
  const conhecido = (roomConfig.rotulos as Record<string, string>)[slug];
  if (conhecido) return conhecido;

  return slug
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

function rotuloDeAudio(audio: string): string {
  const rotulos: Record<string, string> = {
    dublado: 'Dublado',
    legendado: 'Legendado',
    original: 'Áudio original',
  };
  return rotulos[audio] ?? audio;
}

/**
 * Recalcula as tags automáticas de um título.
 *
 * A estratégia é "apaga as auto e recria": mais simples e mais correta que
 * tentar fazer diff, porque a fonte da verdade são as sessões do momento.
 */
export async function recalcularTagsDoTitulo(titleId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const desejadas = await tagsDerivadasDasSessoes(tx, titleId);

    // ⚠️ o filtro por origin é o que protege o trabalho manual
    await tx.titleTag.deleteMany({ where: { titleId, origin: 'auto' } });

    for (const tag of desejadas) {
      const tagId = await garantirTagAuto(tx, tag);

      // a tag pode já estar ligada como MANUAL — nesse caso não mexemos:
      // a marcação manual tem precedência e o sync não a converte em auto
      const jaLigada = await tx.titleTag.findUnique({
        where: { titleId_tagId: { titleId, tagId } },
        select: { origin: true },
      });

      if (jaLigada) continue;

      await tx.titleTag.create({ data: { titleId, tagId, origin: 'auto' } });
    }

    return desejadas.length;
  });
}

/**
 * Recalcula as tags auto de todos os títulos que têm sessão ativa.
 * Roda ao fim de cada sync de sessões (§9).
 */
export async function recalcularTodasAsTagsAuto(): Promise<{
  titulos: number;
  tags: number;
}> {
  const comSessao = await prisma.session.findMany({
    where: { active: true },
    select: { titleId: true },
    distinct: ['titleId'],
  });

  let tags = 0;
  for (const { titleId } of comSessao) {
    tags += await recalcularTagsDoTitulo(titleId);
  }

  // título que não tem mais sessão ativa perde as tags auto, mas mantém as
  // manuais — ele continua no catálogo, só não está em cartaz
  const idsComSessao = comSessao.map((s) => s.titleId);
  const limpos = await prisma.titleTag.deleteMany({
    where: {
      origin: 'auto',
      ...(idsComSessao.length ? { titleId: { notIn: idsComSessao } } : {}),
    },
  });

  log.info('tags automáticas recalculadas', {
    titulos: comSessao.length,
    tags,
    ligacoesRemovidas: limpos.count,
  });

  return { titulos: comSessao.length, tags };
}

export interface FacetaComContagem {
  facet: TagFacet;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
  titulos: number;
}

/**
 * Facetas com contagem — é o que alimenta o painel de tags do §12,
 * "agrupado por faceta, com contagem por item".
 *
 * ⚠️ A contagem usa os MESMOS status que `listarTitulos` (`STATUS_VISIVEIS`),
 * e não "tudo menos merged" como fazia antes. Medido em 24/09/2026: a faceta
 * IMAX dizia 6 títulos e a lista devolvia 4, porque duas ópera/transmissão já
 * marcadas como `not_a_film` na revisão continuavam contando. Um filtro que
 * promete 6 e entrega 4 não é um detalhe de exibição: é o painel mentindo
 * sobre o catálogo.
 */
export async function listarFacetas(opcoes: { apenasEmCartaz?: boolean } = {}): Promise<
  FacetaComContagem[]
> {
  const filtroDeCartaz = opcoes.apenasEmCartaz
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM availabilities a
          WHERE a.title_id = tt.title_id
            AND a.source = 'cinema' AND a.status = 'em_cartaz' AND a.ended_at IS NULL
        )`
    : Prisma.empty;

  const statusVisiveis = [...STATUS_VISIVEIS];

  return prisma.$queryRaw<FacetaComContagem[]>`
    SELECT
      t.facet,
      t.value,
      t.label,
      t.origin::text AS origin,
      t.owner_id     AS "ownerId",
      count(DISTINCT tt.title_id)::int AS titulos
    FROM tags t
    JOIN title_tags tt ON tt.tag_id = t.id
    JOIN titles ti ON ti.id = tt.title_id AND ti.status = ANY (${statusVisiveis}::"TitleStatus"[])
    WHERE TRUE ${filtroDeCartaz}
    GROUP BY t.id, t.facet, t.value, t.label, t.origin, t.owner_id
    ORDER BY t.facet, titulos DESC, t.label
  `;
}

// ─────────────────────────────────────────────────────────────
// TAGS MANUAIS (§6 e passo 11 da §15)
// ─────────────────────────────────────────────────────────────

/**
 * Tags escritas à mão pela Carol e pelo namorado dela.
 *
 * ⚠️ **O sync nunca toca nelas.** Toda a limpeza automática deste arquivo
 * filtra por `origin: 'auto'`, e é isso que separa as duas coisas — perder uma
 * tag manual porque um filme mudou de sala seria imperdoável. Estas funções são
 * o outro lado do mesmo contrato: nada aqui escreve tag `auto`.
 *
 * A tag pertence a QUEM ESCREVEU (`ownerId`), então os dois podem ter uma
 * "maratona" sem uma virar a da outra pessoa. Quem remove é o dono.
 */

const TAMANHO_MAXIMO = 40;

export interface TagManual {
  id: string;
  facet: TagFacet;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
}

export async function adicionarTagManual(
  titleId: string,
  ownerId: string,
  texto: string,
): Promise<TagManual> {
  const label = texto.trim().replace(/\s+/g, ' ');
  if (label.length === 0) {
    throw new ValidationError('A tag precisa de um nome.');
  }
  if (label.length > TAMANHO_MAXIMO) {
    throw new ValidationError(`A tag pode ter no máximo ${TAMANHO_MAXIMO} caracteres.`);
  }

  const value = slugificar(label);
  if (value.length === 0) {
    // "???" vira slug vazio, e slug vazio casaria com qualquer outra tag vazia
    throw new ValidationError('A tag precisa de pelo menos uma letra ou número.');
  }

  const titulo = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true } });
  if (!titulo) {
    throw new NotFoundError(`Título "${titleId}" não existe.`);
  }

  return prisma.$transaction(async (tx) => {
    // (facet, value, ownerId) é único de verdade aqui, porque ownerId não é
    // nulo: o upsert do Prisma dá conta sem SQL cru, ao contrário das auto
    const tag = await tx.tag.upsert({
      where: { facet_value_ownerId: { facet: 'manual', value, ownerId } },
      // o rótulo acompanha a última grafia usada; o slug é que identifica
      update: { label },
      create: { facet: 'manual', value, label, origin: 'manual', ownerId },
      select: { id: true, facet: true, value: true, label: true, origin: true, ownerId: true },
    });

    await tx.titleTag.upsert({
      where: { titleId_tagId: { titleId, tagId: tag.id } },
      update: {},
      create: { titleId, tagId: tag.id, origin: 'manual', addedById: ownerId },
    });

    log.info('tag manual adicionada', { titleId, tag: tag.value, ownerId });
    return { ...tag, origin: tag.origin as string };
  });
}

/**
 * Tira a tag do filme.
 *
 * A `Tag` em si **não** é apagada quando perde o último filme: ela é o
 * vocabulário da pessoa, e some sozinha das telas porque `listarFacetas` só
 * conta tag com título. Apagá-la faria "maratona" desaparecer do banco por ter
 * sido tirada de um filme por engano.
 */
export async function removerTagManual(
  titleId: string,
  tagId: string,
  ownerId: string,
): Promise<void> {
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { id: true, origin: true, ownerId: true, label: true },
  });

  if (!tag) {
    throw new NotFoundError(`Tag "${tagId}" não existe.`);
  }

  // o §10 é explícito: estas rotas são "só tags manuais". Uma tag auto
  // removida por aqui voltaria no sync seguinte, o que pareceria um bug do app
  if (tag.origin !== 'manual') {
    throw new ValidationError(
      `"${tag.label}" é uma tag automática, derivada das sessões — ela volta no próximo sync.`,
    );
  }

  if (tag.ownerId !== ownerId) {
    throw new ValidationError('Esta tag é do outro perfil; só quem criou pode tirá-la.');
  }

  await prisma.titleTag.deleteMany({ where: { titleId, tagId } });
  log.info('tag manual removida', { titleId, tagId, ownerId });
}

/** As tags manuais que a pessoa já usou — alimenta a sugestão ao digitar. */
export async function tagsManuaisDe(ownerId: string): Promise<TagManual[]> {
  const tags = await prisma.tag.findMany({
    where: { facet: 'manual', origin: 'manual', ownerId },
    orderBy: { label: 'asc' },
    select: { id: true, facet: true, value: true, label: true, origin: true, ownerId: true },
  });

  return tags.map((t) => ({ ...t, origin: t.origin as string }));
}
