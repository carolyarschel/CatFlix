import { ConflictError, NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';

const log = logger.child({ module: 'catalog:merge' });

export interface ResultadoDoMerge {
  toTitleId: string;
  aliasId: string;
  repontados: Record<string, number>;
}

/**
 * Une dois `Title` que são o mesmo filme (§7.3).
 *
 * Reponta TODAS as FKs — sessões, ids externos, tags, estados de usuário,
 * créditos, gêneros, estúdios, decisões e pendências —, grava o `TitleAlias` e
 * marca o absorvido como `merged`, **numa transação só**. Um merge pela metade
 * deixaria sessões apontando para um Title que não é mais o certo.
 *
 * O `TitleAlias` não é enfeite: é o que impede o sync de separar de novo, no
 * dia seguinte, o que a Carol acabou de unir.
 */
export async function mergeTitles(
  fromTitleId: string,
  toTitleId: string,
  opcoes: { reason: string; mergedById?: string } = { reason: 'merge manual' },
): Promise<ResultadoDoMerge> {
  if (fromTitleId === toTitleId) {
    throw new ConflictError('Não dá para unir um título com ele mesmo.');
  }

  return prisma.$transaction(async (tx) => {
    const [origem, destino] = await Promise.all([
      tx.title.findUnique({ where: { id: fromTitleId } }),
      tx.title.findUnique({ where: { id: toTitleId } }),
    ]);

    if (!origem) throw new NotFoundError(`Title de origem não encontrado: ${fromTitleId}`);
    if (!destino) throw new NotFoundError(`Title de destino não encontrado: ${toTitleId}`);

    const repontados: Record<string, number> = {};

    // ── ids externos ──────────────────────────────────────────
    // Pode haver colisão: os dois Titles terem um id da mesma fonte. O
    // `@@unique([source, externalId])` impediria o update, então o que colide
    // é descartado (o destino já tem o dele) e o resto migra.
    const idsDoDestino = await tx.titleExternalId.findMany({
      where: { titleId: toTitleId },
      select: { source: true, externalId: true },
    });
    const jaExiste = new Set(idsDoDestino.map((e) => `${e.source}:${e.externalId}`));

    const idsDaOrigem = await tx.titleExternalId.findMany({ where: { titleId: fromTitleId } });
    let idsMigrados = 0;

    for (const externo of idsDaOrigem) {
      if (jaExiste.has(`${externo.source}:${externo.externalId}`)) {
        await tx.titleExternalId.delete({ where: { id: externo.id } });
        continue;
      }
      await tx.titleExternalId.update({ where: { id: externo.id }, data: { titleId: toTitleId } });
      idsMigrados += 1;
    }
    repontados.titleExternalId = idsMigrados;

    // ── sessões ───────────────────────────────────────────────
    repontados.sessions = (
      await tx.session.updateMany({ where: { titleId: fromTitleId }, data: { titleId: toTitleId } })
    ).count;

    // ── disponibilidade ───────────────────────────────────────
    // unique (titleId, source, status): o que o destino já tem é descartado
    const disponibilidades = await tx.availability.findMany({ where: { titleId: fromTitleId } });
    let dispMigradas = 0;

    for (const disp of disponibilidades) {
      const conflito = await tx.availability.findUnique({
        where: {
          titleId_source_status: { titleId: toTitleId, source: disp.source, status: disp.status },
        },
        select: { id: true },
      });

      if (conflito) {
        await tx.availability.delete({ where: { id: disp.id } });
      } else {
        await tx.availability.update({ where: { id: disp.id }, data: { titleId: toTitleId } });
        dispMigradas += 1;
      }
    }
    repontados.availability = dispMigradas;

    // ── estado dos usuários ───────────────────────────────────
    // Se os DOIS perfis marcaram o mesmo filme nos dois Titles, o do destino
    // manda. Perder um "visto" é pior que perder um "quero ver", então o
    // registro mais recente vence.
    const estados = await tx.userTitleState.findMany({ where: { titleId: fromTitleId } });
    let estadosMigrados = 0;

    for (const estado of estados) {
      const existente = await tx.userTitleState.findUnique({
        where: { userId_titleId: { userId: estado.userId, titleId: toTitleId } },
      });

      if (!existente) {
        await tx.userTitleState.update({ where: { id: estado.id }, data: { titleId: toTitleId } });
        estadosMigrados += 1;
        continue;
      }

      if (estado.statusChangedAt > existente.statusChangedAt) {
        await tx.userTitleState.update({
          where: { id: existente.id },
          data: {
            status: estado.status,
            statusChangedAt: estado.statusChangedAt,
            wantedAt: estado.wantedAt ?? existente.wantedAt,
            markedAt: estado.markedAt ?? existente.markedAt,
            watchedAt: estado.watchedAt ?? existente.watchedAt,
          },
        });
        estadosMigrados += 1;
      }

      await tx.userTitleState.delete({ where: { id: estado.id } });
    }
    repontados.userTitleState = estadosMigrados;

    // ── tags ──────────────────────────────────────────────────
    // tags manuais NUNCA se perdem num merge: elas são trabalho da Carol
    const tags = await tx.titleTag.findMany({ where: { titleId: fromTitleId } });
    let tagsMigradas = 0;

    for (const tag of tags) {
      const conflito = await tx.titleTag.findUnique({
        where: { titleId_tagId: { titleId: toTitleId, tagId: tag.tagId } },
        select: { titleId: true },
      });

      if (!conflito) {
        await tx.titleTag.create({
          data: {
            titleId: toTitleId,
            tagId: tag.tagId,
            origin: tag.origin,
            addedById: tag.addedById,
          },
        });
        tagsMigradas += 1;
      }

      await tx.titleTag.delete({ where: { titleId_tagId: { titleId: fromTitleId, tagId: tag.tagId } } });
    }
    repontados.titleTag = tagsMigradas;

    // ── créditos, gêneros e estúdios ──────────────────────────
    // o destino costuma já ter tudo (veio do TMDB); o que colide é descartado
    repontados.credits = await migrarSemDuplicar(
      tx.titleCredit.findMany({ where: { titleId: fromTitleId } }),
      async (c) => {
        const existe = await tx.titleCredit.findUnique({
          where: { titleId_personId_role: { titleId: toTitleId, personId: c.personId, role: c.role } },
          select: { id: true },
        });
        if (existe) await tx.titleCredit.delete({ where: { id: c.id } });
        else await tx.titleCredit.update({ where: { id: c.id }, data: { titleId: toTitleId } });
        return !existe;
      },
    );

    await tx.titleGenre.deleteMany({ where: { titleId: fromTitleId } });
    await tx.titleCompany.deleteMany({ where: { titleId: fromTitleId } });

    // ── rastro ────────────────────────────────────────────────
    // as decisões e pendências passam a apontar para o destino, senão o
    // histórico do matching fica órfão
    repontados.matchDecisions = (
      await tx.matchDecision.updateMany({
        where: { resultTitleId: fromTitleId },
        data: { resultTitleId: toTitleId },
      })
    ).count;

    await tx.reviewItem.updateMany({
      where: { subjectTitleId: fromTitleId },
      data: { subjectTitleId: toTitleId },
    });

    // aliases que apontavam para a origem passam a apontar para o destino,
    // para uma cadeia de merges não quebrar
    await tx.titleAlias.updateMany({
      where: { toTitleId: fromTitleId },
      data: { toTitleId },
    });

    const alias = await tx.titleAlias.create({
      data: {
        fromTitleId,
        toTitleId,
        reason: opcoes.reason,
        mergedById: opcoes.mergedById ?? null,
        snapshot: {
          title: origem.title,
          originalTitle: origem.originalTitle,
          year: origem.year,
          status: origem.status,
          runtimeMinutes: origem.runtimeMinutes,
        },
      },
      select: { id: true },
    });

    // O Title absorvido vira lápide em vez de sumir: o TitleAlias aponta para
    // ele com FK Cascade, então apagá-lo levaria o registro do merge junto.
    // Sem sessões e sem ids externos (todos migraram), não aparece no app.
    await tx.title.update({
      where: { id: fromTitleId },
      data: { status: 'merged' },
    });

    log.info('titles unidos', { fromTitleId, toTitleId, repontados });

    return { toTitleId, aliasId: alias.id, repontados };
  });
}

async function migrarSemDuplicar<T>(
  consulta: Promise<T[]>,
  mover: (item: T) => Promise<boolean>,
): Promise<number> {
  const itens = await consulta;
  let movidos = 0;
  for (const item of itens) if (await mover(item)) movidos += 1;
  return movidos;
}
