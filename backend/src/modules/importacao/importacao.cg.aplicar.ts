import type { Pessoa, ReviewReason } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { normalizarTitulo } from '../matching/matching.normalizer';
import { adicionarPorTmdbId } from '../library/library.service';
import { adicionarTagManual } from '../tags/tags.service';
import type { TmdbClient } from '../tmdb';
import type { Casamento } from './importacao.cg.casamento';
import type { FilmeDoCg } from './importacao.cg.leitura';

const log = logger.child({ module: 'importacao' });

/**
 * Grava um filme do CG no acervo do casal (cineon-expansao §11).
 *
 * **Idempotente:** o filme importado ganha um `TitleExternalId` com
 * `source = 'cronicas_gatur'` e a chave do CG, gravado NA MESMA transação das
 * visualizações, da lista e das notas. Rodar o script de novo pula o que já
 * tem essa chave — nunca duplica uma visualização. As tags (Favorito) vêm
 * depois, mas `adicionarTagManual` já é idempotente.
 *
 * Casamento certo → o filme do TMDB (reaproveitado se já estiver no catálogo).
 * Dúvida ou sem candidato → um `Title` órfão com os dados e uma pendência na
 * fila Revisar; quando a Carol resolver, o `mergeTitles` leva tudo para o
 * filme do TMDB.
 */

export type ResultadoDoFilme =
  | { tipo: 'ja_importado'; titleId: string }
  | { tipo: 'importado'; titleId: string; revisao: boolean };

const PERFIL_DA_PESSOA: Record<Pessoa, string> = { CAT: 'catflix', BEAR: 'hburso' };

/** "🐱 …\n🐻 …" — cada comentário com o rosto de quem escreveu, como no CG. */
export function observacao(comentarios: FilmeDoCg['comentarios']): string | null {
  const partes = [
    comentarios.CAT ? `🐱 ${comentarios.CAT}` : null,
    comentarios.BEAR ? `🐻 ${comentarios.BEAR}` : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join('\n') : null;
}

export async function importarFilme(
  filme: FilmeDoCg,
  casamento: Casamento,
  tmdb: TmdbClient,
): Promise<ResultadoDoFilme> {
  const ja = await prisma.titleExternalId.findUnique({
    where: { source_externalId: { source: 'cronicas_gatur', externalId: filme.chave } },
    select: { titleId: true },
  });
  if (ja) return { tipo: 'ja_importado', titleId: ja.titleId };

  // fora da transação: fala com o TMDB, e o filme pode já existir pelo cinema
  const titleIdDoTmdb =
    casamento.tipo === 'certo' ? (await adicionarPorTmdbId(casamento.tmdbId, tmdb)).titleId : null;

  const ano = filme.lancamento ? Number(filme.lancamento.slice(0, 4)) : null;
  const nota = observacao(filme.comentarios);
  const motivo = casamento.tipo === 'certo' ? '' : casamento.motivo;

  const titleId = await prisma.$transaction(async (tx) => {
    let id = titleIdDoTmdb;

    if (!id) {
      const normalizado = normalizarTitulo(filme.titulo).normalizado;
      id = (
        await tx.title.create({
          data: {
            status: 'orphan',
            title: filme.titulo,
            normalizedTitle: normalizado,
            year: ano,
            runtimeMinutes: filme.duracaoMinutos,
          },
          select: { id: true },
        })
      ).id;

      const reason: ReviewReason = casamento.tipo === 'sem_candidato' ? 'no_candidate' : 'import_low_confidence';
      await tx.reviewItem.create({
        data: {
          origin: 'importacao_cg',
          ingressoEventId: null,
          ingressoTitle: filme.titulo,
          ingressoYear: ano,
          ingressoPayload: { director: filme.diretor, runtimeMinutes: filme.duracaoMinutos, chaveCg: filme.chave },
          subjectTitleId: id,
          candidateTmdbId: casamento.tipo === 'duvida' ? casamento.candidato.tmdbId : null,
          candidateLabel:
            casamento.tipo === 'duvida'
              ? `${casamento.candidato.titulo}${casamento.candidato.ano ? ` (${casamento.candidato.ano})` : ''}`
              : null,
          reason,
          note: `Importado do Crônicas de Gatur. ${motivo}`,
        },
      });
    }

    await tx.titleExternalId.create({
      data: {
        titleId: id,
        source: 'cronicas_gatur',
        externalId: filme.chave,
        method: casamento.tipo === 'certo' ? 'exact' : 'fuzzy',
        confidence: casamento.tipo === 'certo' ? 1 : null,
      },
    });

    // filme sem revisto no CG: a observação vai para a (única) visualização
    for (const [i, v] of filme.visualizacoes.entries()) {
      await tx.watch.create({
        data: {
          titleId: id,
          watchedOn: new Date(`${v.data}T00:00:00Z`),
          datePrecision: 'DIA',
          location: v.local,
          participants: v.participantes,
          note: i === 0 ? nota : null,
        },
      });
    }

    // A regra do app (§3.3), também entre itens: o catálogo do CG tem filmes
    // repetidos (8 em 19/11/2026), e um item pode ter a visualização enquanto o
    // outro tem a lista. Quem assistiu — por este item ou por um importado
    // antes — sai da lista e não volta para ela.
    const assistiram = new Set(
      (await tx.watch.findMany({ where: { titleId: id, removedAt: null }, select: { participants: true } })).flatMap(
        (w) => w.participants,
      ),
    );
    if (assistiram.size > 0) {
      await tx.watchlistEntry.updateMany({
        where: { titleId: id, pessoa: { in: [...assistiram] }, removedAt: null },
        data: { removedAt: new Date() },
      });
    }

    for (const l of filme.lista.filter((x) => !assistiram.has(x.pessoa))) {
      await tx.watchlistEntry.upsert({
        where: { titleId_pessoa: { titleId: id, pessoa: l.pessoa } },
        create: { titleId: id, pessoa: l.pessoa, interest: l.interesse },
        update: { removedAt: null, interest: l.interesse },
      });
    }

    for (const n of filme.notas) {
      await tx.rating.upsert({
        where: { titleId_pessoa: { titleId: id, pessoa: n.pessoa } },
        create: { titleId: id, pessoa: n.pessoa, score: n.nota },
        update: { score: n.nota, removedAt: null },
      });
    }

    return id;
  });

  for (const pessoa of filme.favoritos) {
    await adicionarTagManual(titleId, PERFIL_DA_PESSOA[pessoa], 'Favorito');
  }

  log.info('filme do CG importado', { chave: filme.chave, titleId, casamento: casamento.tipo });
  return { tipo: 'importado', titleId, revisao: casamento.tipo !== 'certo' };
}
