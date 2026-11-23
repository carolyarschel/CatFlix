/**
 * Feed para o Crônicas de Gatur (cineon-expansao §10.2, Contrato de Feed v1). Só leitura.
 *
 * - Cada `Watch` (visualização) vira um item pontual: `idNaFonte = watch:<id>`.
 * - Categoria pelo local: CINEMA → `filme.cinema`, CASA → `filme.casa` (as categorias já
 *   combinadas no contexto do CG; o `filme.assistido` do §10.2 virou essas duas).
 * - `atualizadoEm` do item = o maior entre o da visualização, o do título e os das notas e
 *   comentários do título: mudar uma nota reenvia todas as visualizações daquele filme.
 * - `removedAt` → `removido: true`. A lista "quero assistir" não vai para o feed.
 * - Paginação: `desde` (inclusivo) + cursor opaco sobre (`atualizadoEm`, id).
 */
import { Prisma, type DatePrecision, type Pessoa } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { ValidationError } from '../../shared/errors';
import type { FeedItem, FeedNota, FeedResposta, ProvedorExternoFeed } from './feed.types';

export const LIMITE_PADRAO = 100;
export const LIMITE_MAXIMO = 500;

export interface PedidoDoFeed {
  desde: Date | null;
  cursor: { atualizadoEm: Date; id: string } | null;
  limite: number;
}

function dataIso(valor: unknown, campo: string): Date | null {
  if (valor === undefined || valor === '') return null;
  const data = typeof valor === 'string' ? new Date(valor) : null;
  if (!data || Number.isNaN(data.getTime())) throw new ValidationError(`${campo} precisa ser uma data ISO-8601.`);
  return data;
}

export function codificarCursor(atualizadoEm: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: atualizadoEm.toISOString(), id })).toString('base64url');
}

function decodificarCursor(valor: unknown): PedidoDoFeed['cursor'] {
  if (valor === undefined || valor === '') return null;
  try {
    const { t, id } = JSON.parse(Buffer.from(String(valor), 'base64url').toString('utf8')) as { t?: unknown; id?: unknown };
    const atualizadoEm = typeof t === 'string' ? new Date(t) : null;
    if (!atualizadoEm || Number.isNaN(atualizadoEm.getTime()) || typeof id !== 'string' || id.length === 0 || id.length > 64) {
      throw new Error('cursor');
    }
    return { atualizadoEm, id };
  } catch {
    throw new ValidationError('cursor inválido.');
  }
}

/** Lê `?desde&cursor&limite` (400 se algo vier errado). */
export function lerPedido(query: Record<string, unknown>): PedidoDoFeed {
  const limite = query.limite === undefined ? LIMITE_PADRAO : Number(query.limite);
  if (!Number.isInteger(limite) || limite < 1) {
    throw new ValidationError(`limite precisa ser um inteiro de 1 a ${LIMITE_MAXIMO}.`);
  }
  return {
    desde: dataIso(query.desde, 'desde'),
    cursor: decodificarCursor(query.cursor),
    limite: Math.min(limite, LIMITE_MAXIMO),
  };
}

/** O que o mapeamento precisa de uma visualização (carregado pelo Prisma em `lerFeed`). */
export interface VisualizacaoDoFeed {
  id: string;
  watchedOn: Date;
  datePrecision: DatePrecision;
  location: 'CASA' | 'CINEMA';
  participants: Pessoa[];
  removedAt: Date | null;
  title: {
    mediaType: 'movie' | 'series';
    title: string;
    originalTitle: string | null;
    year: number | null;
    runtimeMinutes: number | null;
    posterUrl: string | null;
    externalIds: { source: string; externalId: string }[];
    genres: { genre: { name: string } }[];
    ratings: { pessoa: Pessoa; score: Prisma.Decimal | number }[];
    comments: { pessoa: Pessoa; text: string }[];
  };
}

const PROVEDOR: Partial<Record<string, ProvedorExternoFeed>> = { tmdb: 'TMDB', imdb: 'IMDB' };

function capaValida(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Uma visualização como item do feed. Função pura (testada sem banco). */
export function itemDaVisualizacao(w: VisualizacaoDoFeed, atualizadoEm: Date): FeedItem {
  const t = w.title;
  const serie = t.mediaType === 'series';

  const idsExternos: Partial<Record<ProvedorExternoFeed, string>> = {};
  for (const e of t.externalIds) {
    const provedor = PROVEDOR[e.source];
    if (provedor) idsExternos[provedor] = e.externalId;
  }

  // Nota de cada pessoa, com o comentário dela sobre o filme. Comentário sem nota não vai:
  // o contrato exige `valor`.
  const comentario = new Map(t.comments.map((c) => [c.pessoa, c.text]));
  const notas: FeedNota[] = t.ratings.map((r) => ({
    papel: r.pessoa,
    valor: Number(r.score),
    escalaMax: 10,
    ...(comentario.get(r.pessoa) ? { comentario: comentario.get(r.pessoa)!.slice(0, 2000) } : {}),
  }));

  const capaUrl = capaValida(t.posterUrl);
  const generos = t.genres.map((g) => g.genre.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return {
    idNaFonte: `watch:${w.id}`,
    tipo: 'MIDIA',
    formato: 'PONTO',
    // Série: o CG ainda não definiu as categorias (seção 7 do contexto dele); sem categoria,
    // o evento entra com o título genérico. Hoje o Cineon só registra filmes.
    ...(serie ? {} : { categoria: w.location === 'CINEMA' ? 'filme.cinema' : 'filme.casa' }),
    obra: {
      tipo: serie ? 'SERIE' : 'FILME',
      titulo: t.title,
      ...(t.originalTitle && t.originalTitle !== t.title ? { tituloOriginal: t.originalTitle } : {}),
      ...(t.year !== null ? { ano: t.year } : {}),
      ...(capaUrl ? { capaUrl } : {}),
      idsExternos,
      // Duração do filme: é dela que sai o "tempo de filme" das estatísticas do CG.
      ...(t.runtimeMinutes ? { totais: { duracaoMin: t.runtimeMinutes } } : {}),
      // Para a retrospectiva do CG (gênero mais assistido, seção 11.3 do contexto dele).
      ...(generos.length > 0 ? { metadados: { generos } } : {}),
    },
    inicio: w.watchedOn.toISOString(),
    precisaoInicio: w.datePrecision,
    participantes: [...new Set(w.participants)].sort(),
    ...(notas.length > 0 ? { notas } : {}),
    atualizadoEm: atualizadoEm.toISOString(),
    ...(w.removedAt ? { removido: true } : {}),
  };
}

export async function lerFeed(pedido: PedidoDoFeed): Promise<FeedResposta> {
  // Ordem e `atualizadoEm` composto saem do banco; os dados completos vêm depois, pelo Prisma.
  const cursorT = pedido.cursor?.atualizadoEm ?? null;
  const cursorId = pedido.cursor?.id ?? null;
  const pagina = await prisma.$queryRaw<{ id: string; atualizado: Date }[]>(Prisma.sql`
    WITH itens AS (
      SELECT w.id,
             GREATEST(w.updated_at, t.updated_at,
                      COALESCE(r.atualizado, w.updated_at), COALESCE(c.atualizado, w.updated_at)) AS atualizado
        FROM watches w
        JOIN titles t ON t.id = w.title_id
        LEFT JOIN (SELECT title_id, MAX(updated_at) AS atualizado FROM ratings GROUP BY title_id) r ON r.title_id = w.title_id
        LEFT JOIN (SELECT title_id, MAX(updated_at) AS atualizado FROM comments GROUP BY title_id) c ON c.title_id = w.title_id
    )
    SELECT id, atualizado FROM itens
     WHERE (${pedido.desde}::timestamptz IS NULL OR atualizado >= ${pedido.desde}::timestamptz)
       AND (${cursorT}::timestamptz IS NULL OR (atualizado, id) > (${cursorT}::timestamptz, ${cursorId}::text))
     ORDER BY atualizado, id
     LIMIT ${pedido.limite + 1}
  `);

  const temMais = pagina.length > pedido.limite;
  const desta = pagina.slice(0, pedido.limite);
  if (desta.length === 0) return { itens: [], proximoCursor: null };

  const visualizacoes = await prisma.watch.findMany({
    where: { id: { in: desta.map((l) => l.id) } },
    select: {
      id: true,
      watchedOn: true,
      datePrecision: true,
      location: true,
      participants: true,
      removedAt: true,
      title: {
        select: {
          mediaType: true,
          title: true,
          originalTitle: true,
          year: true,
          runtimeMinutes: true,
          posterUrl: true,
          externalIds: { where: { source: { in: ['tmdb', 'imdb'] } }, select: { source: true, externalId: true } },
          genres: { select: { genre: { select: { name: true } } } },
          ratings: { where: { removedAt: null }, select: { pessoa: true, score: true } },
          comments: { where: { removedAt: null }, select: { pessoa: true, text: true } },
        },
      },
    },
  });
  const porId = new Map(visualizacoes.map((w) => [w.id, w]));

  const itens = desta.map(({ id, atualizado }) => itemDaVisualizacao(porId.get(id)!, atualizado));
  const ultimo = desta[desta.length - 1]!;
  return { itens, proximoCursor: temMais ? codificarCursor(ultimo.atualizado, ultimo.id) : null };
}
