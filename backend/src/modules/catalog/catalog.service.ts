import type { Prisma, PrismaClient, TitleStatus } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { MetadataNormalizada } from '../tmdb';
// Import direto do arquivo puro, NÃO do barril do matching: o barril puxa
// `matching.sources`, que puxa o TMDB e o Postgres, e o `matching` já depende
// do `catalog` (§11). Assim não há ciclo — o normalizador só conhece config.
import { normalizarTitulo } from '../matching/matching.normalizer';
import type { DecisaoDeMatching, EventoParaMatching } from '../matching/matching.types';

const log = logger.child({ module: 'catalog' });

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

export interface ResultadoDaAplicacao {
  titleId: string;
  criouTitle: boolean;
  abriuPendencia: boolean;
  reviewItemId?: string;
}

/**
 * Transforma uma decisão de matching em linhas do catálogo.
 *
 * Duas regras do projeto mandam aqui, e as duas empurram na mesma direção:
 *
 *   §2 "Nenhum filme some" — evento que não casa vira `Title` órfão, visível
 *   no app com aviso de metadata pendente. Por isso TODO desfecho termina com
 *   um `titleId`, inclusive `not_a_film` e `no_candidate`.
 *
 *   §2 "Nenhum match duvidoso é aceito em silêncio" — qualquer coisa que não
 *   seja aceitação entra na fila de revisão.
 *
 * Title e ReviewItem são gravados na MESMA transação, de propósito: um título
 * órfão sem a pendência correspondente é um filme que some da fila e nunca é
 * revisado.
 */
export async function aplicarDecisao(
  evento: EventoParaMatching,
  decisao: DecisaoDeMatching,
  opcoes: { metadata?: MetadataNormalizada } = {},
): Promise<ResultadoDaAplicacao> {
  return prisma.$transaction(async (tx) => {
    // 1. resolve o Title
    const { titleId, criouTitle } = await resolverTitle(tx, evento, decisao, opcoes.metadata);

    // 2. liga o id do ingresso a ele — é isto que faz o estágio 0 do matching
    //    funcionar no próximo sync
    await ligarIdDoIngresso(tx, titleId, evento.ingressoEventId, decisao, evento.siteUrl);

    // 3. abre pendência quando a decisão não foi limpa
    const reviewItemId = await talvezAbrirPendencia(tx, evento, decisao, titleId);

    return {
      titleId,
      criouTitle,
      abriuPendencia: reviewItemId !== null,
      ...(reviewItemId ? { reviewItemId } : {}),
    };
  });
}

async function resolverTitle(
  tx: ClientePrisma,
  evento: EventoParaMatching,
  decisao: DecisaoDeMatching,
  metadata?: MetadataNormalizada,
): Promise<{ titleId: string; criouTitle: boolean }> {
  // (a) a decisão já aponta para um Title existente (cache ou dedup)
  if (decisao.titleId) {
    return { titleId: decisao.titleId, criouTitle: false };
  }

  // (b) tem candidato do TMDB e metadata: vira Title completo
  if (decisao.outcome === 'accepted' && decisao.candidateTmdbId && metadata) {
    const titleId = await upsertPorTmdbId(tx, metadata);
    return { titleId, criouTitle: true };
  }

  // (c) todo o resto vira Title com o que o ingresso deu.
  //     Órfão ou não-filme, ele EXISTE e aparece no app.
  const status: TitleStatus = decisao.outcome === 'not_a_film' ? 'not_a_film' : 'orphan';
  const titleId = await criarTitleDoIngresso(tx, evento, status);
  return { titleId, criouTitle: true };
}

/**
 * Cria ou atualiza o `Title` canônico a partir da metadata do TMDB.
 *
 * O `tmdb_id` é a chave: se já existe um `Title` com ele, atualizamos em vez de
 * criar outro. É assim que o critério de aceite nº 2 ("nenhum tmdb_id em dois
 * Titles") se sustenta no código, e não só no índice.
 */
export async function upsertPorTmdbId(
  tx: ClientePrisma,
  metadata: MetadataNormalizada,
): Promise<string> {
  const existente = await tx.titleExternalId.findUnique({
    where: { source_externalId: { source: 'tmdb', externalId: String(metadata.tmdbId) } },
    select: { titleId: true },
  });

  const normalizado = normalizarTitulo(metadata.title);
  const normalizadoOriginal = metadata.originalTitle
    ? normalizarTitulo(metadata.originalTitle).normalizado
    : null;

  const dados = {
    status: 'matched' as const,
    title: metadata.title,
    originalTitle: metadata.originalTitle,
    normalizedTitle: normalizado.normalizado,
    normalizedOriginalTitle: normalizadoOriginal,
    year: metadata.yearBr ?? metadata.year,
    // Estreia BRASILEIRA quando o TMDB conhece. É a data certa para este app:
    // a cadência de notas do §5.3 ("diária na primeira semana após a estreia")
    // se refere a quando o filme entrou em cartaz AQUI, não lá fora.
    releaseDate: metadata.releaseDateBr ?? metadata.releaseDate,
    runtimeMinutes: metadata.runtimeMinutes,
    overview: metadata.overview,
    posterUrl: metadata.posterUrl,
    backdropUrl: metadata.backdropUrl,
    metadataUpdatedAt: new Date(),
  };

  const titleId = existente
    ? (await tx.title.update({ where: { id: existente.titleId }, data: dados, select: { id: true } })).id
    : (await tx.title.create({ data: dados, select: { id: true } })).id;

  if (!existente) {
    await tx.titleExternalId.create({
      data: {
        titleId,
        source: 'tmdb',
        externalId: String(metadata.tmdbId),
        method: 'exact',
        confidence: 1,
      },
    });
  }

  if (metadata.imdbId) {
    await tx.titleExternalId.upsert({
      where: { source_externalId: { source: 'imdb', externalId: metadata.imdbId } },
      update: {},
      create: { titleId, source: 'imdb', externalId: metadata.imdbId, method: 'exact', confidence: 1 },
    });
  }

  await sincronizarGeneros(tx, titleId, metadata);
  await sincronizarEstudios(tx, titleId, metadata);
  await sincronizarCreditos(tx, titleId, metadata);

  return titleId;
}

/**
 * Title feito só com o que o ingresso deu. É o "órfão" do §2: aparece no app
 * com aviso de metadata pendente, em vez de sumir.
 */
async function criarTitleDoIngresso(
  tx: ClientePrisma,
  evento: EventoParaMatching,
  status: TitleStatus,
): Promise<string> {
  const normalizado = normalizarTitulo(evento.title);

  const criado = await tx.title.create({
    data: {
      status,
      title: evento.title,
      originalTitle: evento.originalTitle,
      normalizedTitle: normalizado.normalizado,
      normalizedOriginalTitle: evento.originalTitle
        ? normalizarTitulo(evento.originalTitle).normalizado
        : null,
      year: evento.year,
      runtimeMinutes: evento.runtimeMinutes,
    },
    select: { id: true },
  });

  log.info('title criado sem metadata', {
    titleId: criado.id,
    titulo: evento.title,
    status,
  });

  return criado.id;
}

/**
 * Vários ids do ingresso podem apontar para o mesmo Title (dublado, IMAX,
 * pré-estreia, reexibição). O que não pode é um id apontar para dois.
 */
async function ligarIdDoIngresso(
  tx: ClientePrisma,
  titleId: string,
  ingressoEventId: string,
  decisao: DecisaoDeMatching,
  siteUrl: string | null,
): Promise<void> {
  await tx.titleExternalId.upsert({
    where: { source_externalId: { source: 'ingresso', externalId: ingressoEventId } },
    // o `update` segue vazio para tudo que é decisão de matching — reescrever
    // `method` aqui apagaria um "manual" da revisão no sync seguinte. A URL é
    // exceção: é fato da fonte, não decisão nossa, e o ingresso troca o slug
    // quando o filme muda de título. `undefined` não apaga o que já havia.
    update: { sourceUrl: siteUrl ?? undefined },
    create: {
      titleId,
      source: 'ingresso',
      externalId: ingressoEventId,
      method: metodoDaDecisao(decisao),
      confidence: decisao.score?.total ?? null,
      sourceUrl: siteUrl,
    },
  });
}

function metodoDaDecisao(decisao: DecisaoDeMatching): 'cache' | 'exact' | 'fuzzy' | 'manual' {
  if (decisao.stage === 'cache') return 'cache';
  if (decisao.stage === 'strong') return 'exact';
  return 'fuzzy';
}

/**
 * Fila de revisão. O índice parcial `review_items_one_open_per_event` garante
 * que três syncs por dia não empilhem três pendências do mesmo filme — sem
 * ele, o badge mentiria.
 */
async function talvezAbrirPendencia(
  tx: ClientePrisma,
  evento: EventoParaMatching,
  decisao: DecisaoDeMatching,
  titleId: string,
): Promise<string | null> {
  if (decisao.outcome === 'accepted' || !decisao.reviewReason) return null;

  const jaAberta = await tx.reviewItem.findFirst({
    where: { ingressoEventId: evento.ingressoEventId, status: 'open' },
    select: { id: true },
  });
  if (jaAberta) return jaAberta.id;

  const criada = await tx.reviewItem.create({
    data: {
      ingressoEventId: evento.ingressoEventId,
      ingressoTitle: evento.title,
      ingressoYear: evento.year,
      ingressoPayload: {
        originalTitle: evento.originalTitle,
        runtimeMinutes: evento.runtimeMinutes,
        distributor: evento.distributor,
      },
      subjectTitleId: titleId,
      candidateTmdbId: decisao.candidateTmdbId ?? null,
      candidateTitleId: decisao.titleId ?? null,
      candidateLabel: decisao.candidateLabel ?? null,
      score: decisao.score?.total ?? null,
      reason: decisao.reviewReason,
      note: decisao.reason,
    },
    select: { id: true },
  });

  return criada.id;
}

// ── relações de metadata ─────────────────────────────────────

async function sincronizarGeneros(
  tx: ClientePrisma,
  titleId: string,
  metadata: MetadataNormalizada,
): Promise<void> {
  for (const genero of metadata.genres) {
    const registro = await tx.genre.upsert({
      where: { tmdbId: genero.tmdbId },
      update: { name: genero.name },
      create: { tmdbId: genero.tmdbId, name: genero.name },
      select: { id: true },
    });

    await tx.titleGenre.upsert({
      where: { titleId_genreId: { titleId, genreId: registro.id } },
      update: {},
      create: { titleId, genreId: registro.id },
    });
  }
}

async function sincronizarEstudios(
  tx: ClientePrisma,
  titleId: string,
  metadata: MetadataNormalizada,
): Promise<void> {
  for (const empresa of metadata.companies) {
    const registro = await tx.company.upsert({
      where: { tmdbId: empresa.tmdbId },
      update: { name: empresa.name, logoUrl: empresa.logoUrl },
      create: {
        tmdbId: empresa.tmdbId,
        name: empresa.name,
        logoUrl: empresa.logoUrl,
        originCountry: empresa.originCountry,
      },
      select: { id: true },
    });

    await tx.titleCompany.upsert({
      where: { titleId_companyId: { titleId, companyId: registro.id } },
      update: {},
      create: { titleId, companyId: registro.id },
    });
  }
}

async function sincronizarCreditos(
  tx: ClientePrisma,
  titleId: string,
  metadata: MetadataNormalizada,
): Promise<void> {
  for (const credito of metadata.credits) {
    const pessoa = await tx.person.upsert({
      where: { tmdbId: credito.tmdbId },
      update: { name: credito.name, profileUrl: credito.profileUrl },
      create: { tmdbId: credito.tmdbId, name: credito.name, profileUrl: credito.profileUrl },
      select: { id: true },
    });

    await tx.titleCredit.upsert({
      where: {
        titleId_personId_role: { titleId, personId: pessoa.id, role: credito.role },
      },
      update: { character: credito.character, order: credito.order },
      create: {
        titleId,
        personId: pessoa.id,
        role: credito.role,
        character: credito.character,
        order: credito.order,
      },
    });
  }
}

/** Atualiza só as notas, sem tocar no resto (§5.3). */
export async function atualizarNotas(
  titleId: string,
  notas: { imdbRating: number | null; rtRating: number | null },
): Promise<void> {
  await prisma.title.update({
    where: { id: titleId },
    data: {
      imdbRating: notas.imdbRating,
      rtRating: notas.rtRating,
      ratingsUpdatedAt: new Date(),
    },
  });
}
