import type { DatePrecision, Pessoa, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
// arquivo do serviço, não o barril: o barril exporta rotas
import { diaNoFuso } from '../cinemas/cinemas.queries';
import { fusoDaCidade } from '../cinemas/cinemas.service';
import type {
  DadosDaVisualizacao,
  FiltrosDeVisualizacoes,
  VisualizacaoDaLista,
  VisualizacaoDoTitulo,
} from './watches.types';

/**
 * Visualizações: "já assistimos" (cineon-expansao §3.2).
 *
 * Um filme pode ter várias (rever conta). Assistido é SEMPRE derivado daqui,
 * nunca gravado como status (§14). Apagar é `removedAt` (§2).
 *
 * Este módulo não conhece a lista "quero assistir" nem as notas: tirar da
 * lista ao registrar e exigir visualização para dar nota são regras do
 * orquestrador `library` (§9).
 */

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const SELECAO = {
  id: true,
  titleId: true,
  watchedOn: true,
  datePrecision: true,
  location: true,
  participants: true,
  cinemaId: true,
  cinemaFreeName: true,
  roomType: true,
  note: true,
  updatedAt: true,
  cinema: { select: { name: true } },
} as const;

type WatchCru = Prisma.WatchGetPayload<{ select: typeof SELECAO }>;

// ── data com precisão ────────────────────────────────────────

/**
 * `AAAA-MM-DD` → dia; `AAAA-MM` → mês (guardado no dia 1); `AAAA` → ano
 * (guardado em 1º de janeiro). Data impossível é erro, não "o dia seguinte".
 */
export function lerDataComPrecisao(texto: string): { data: Date; precisao: DatePrecision } {
  const casado = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(texto.trim());
  if (!casado) {
    throw new ValidationError(`Data inválida: "${texto}". Use AAAA-MM-DD, AAAA-MM ou AAAA.`);
  }

  const [, ano, mes, dia] = casado;
  const precisao: DatePrecision = dia ? 'DIA' : mes ? 'MES' : 'ANO';
  const data = new Date(Date.UTC(Number(ano), mes ? Number(mes) - 1 : 0, dia ? Number(dia) : 1));

  const esperado = `${ano}-${mes ?? '01'}-${dia ?? '01'}`;
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== esperado) {
    throw new ValidationError(`Data impossível: "${texto}".`);
  }

  return { data, precisao };
}

/** O inverso: a data como foi dita, sem inventar dia que ninguém lembra. */
export function escreverDataComPrecisao(data: Date, precisao: DatePrecision): string {
  const iso = data.toISOString().slice(0, 10);
  if (precisao === 'ANO') return iso.slice(0, 4);
  if (precisao === 'MES') return iso.slice(0, 7);
  return iso;
}

// ── validação ────────────────────────────────────────────────

/**
 * As regras da visualização que cabem neste módulo. As que o banco também
 * garante (CHECKs da migration) são repetidas aqui para a pessoa receber uma
 * mensagem em português em vez de um erro de restrição.
 */
async function validar(
  db: ClientePrisma,
  dados: DadosDaVisualizacao,
): Promise<Omit<Prisma.WatchUncheckedCreateInput, 'titleId'>> {
  const { data, precisao } = lerDataComPrecisao(dados.data);

  // "hoje" é o da cidade, não o do servidor: às 22h no Brasil o servidor em
  // UTC já está no dia seguinte
  const hoje = diaNoFuso(new Date(), await fusoDaCidade());
  if (data.toISOString().slice(0, 10) > hoje) {
    throw new ValidationError('A data da visualização está no futuro.');
  }

  const participantes = [...new Set(dados.participantes)];
  if (participantes.length === 0) {
    throw new ValidationError('Diga quem assistiu: pelo menos uma pessoa.');
  }

  const cinemaNomeLivre = dados.cinemaNomeLivre?.trim() || null;
  const tipoSala = dados.tipoSala?.trim() || null;
  const cinemaId = dados.cinemaId || null;

  if (dados.local === 'CASA' && (cinemaId || cinemaNomeLivre || tipoSala)) {
    throw new ValidationError('Cinema e sala só valem quando foi no cinema.');
  }
  if (cinemaId && cinemaNomeLivre) {
    throw new ValidationError('Escolha um cinema da lista ou escreva o nome, não os dois.');
  }
  if (cinemaId) {
    const existe = await db.cinema.findUnique({ where: { id: cinemaId }, select: { id: true } });
    if (!existe) throw new ValidationError(`Cinema "${cinemaId}" não existe.`);
  }

  return {
    watchedOn: data,
    datePrecision: precisao,
    location: dados.local,
    participants: participantes,
    cinemaId,
    cinemaFreeName: cinemaNomeLivre,
    roomType: tipoSala,
    note: dados.observacao?.trim() || null,
  };
}

function formatar(w: WatchCru): VisualizacaoDoTitulo {
  return {
    id: w.id,
    titleId: w.titleId,
    data: escreverDataComPrecisao(w.watchedOn, w.datePrecision),
    precisao: w.datePrecision,
    local: w.location,
    participantes: w.participants,
    cinemaId: w.cinemaId,
    cinema: w.cinema?.name ?? w.cinemaFreeName,
    tipoSala: w.roomType,
    observacao: w.note,
    atualizadoEm: w.updatedAt,
  };
}

// ── escrita ──────────────────────────────────────────────────

export async function registrarVisualizacao(
  titleId: string,
  dados: DadosDaVisualizacao,
  db: ClientePrisma = prisma,
): Promise<VisualizacaoDoTitulo> {
  const titulo = await db.title.findUnique({ where: { id: titleId }, select: { status: true } });
  if (!titulo) throw new NotFoundError(`Título "${titleId}" não existe.`);
  if (titulo.status === 'merged') {
    throw new ValidationError('Este título foi unido a outro; registre no filme que ficou.');
  }

  const criada = await db.watch.create({
    data: { titleId, ...(await validar(db, dados)) },
    select: SELECAO,
  });
  return formatar(criada);
}

/** Edição parcial: o que não veio continua como estava. */
export async function editarVisualizacao(
  id: string,
  parcial: Partial<DadosDaVisualizacao>,
): Promise<VisualizacaoDoTitulo> {
  const atual = await prisma.watch.findFirst({ where: { id, removedAt: null }, select: SELECAO });
  if (!atual) throw new NotFoundError(`Visualização "${id}" não existe.`);

  const local = parcial.local ?? atual.location;
  // mudar para casa limpa o cinema, em vez de deixar a edição falhar no CHECK
  const vaiParaCasa = local === 'CASA';

  const mesclado: DadosDaVisualizacao = {
    data: parcial.data ?? escreverDataComPrecisao(atual.watchedOn, atual.datePrecision),
    local,
    participantes: parcial.participantes ?? atual.participants,
    cinemaId: vaiParaCasa ? null : parcial.cinemaId !== undefined ? parcial.cinemaId : atual.cinemaId,
    cinemaNomeLivre: vaiParaCasa
      ? null
      : parcial.cinemaNomeLivre !== undefined
        ? parcial.cinemaNomeLivre
        : atual.cinemaFreeName,
    tipoSala: vaiParaCasa ? null : parcial.tipoSala !== undefined ? parcial.tipoSala : atual.roomType,
    observacao: parcial.observacao !== undefined ? parcial.observacao : atual.note,
  };

  const editada = await prisma.watch.update({
    where: { id },
    data: await validar(prisma, mesclado),
    select: SELECAO,
  });
  return formatar(editada);
}

/** Marca como removida; a linha fica (§2). */
export async function removerVisualizacao(id: string): Promise<{ removidoEm: Date }> {
  const removidoEm = new Date();
  const { count } = await prisma.watch.updateMany({
    where: { id, removedAt: null },
    data: { removedAt: removidoEm },
  });
  if (count === 0) throw new NotFoundError(`Visualização "${id}" não existe.`);
  return { removidoEm };
}

/** "Remover do catálogo" (§4.4): todas as do título, com um carimbo só. */
export async function removerVisualizacoesDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.watch.updateMany({ where: { titleId, removedAt: null }, data: { removedAt: removidoEm } })
  ).count;
}

/** Desfaz exatamente o que aquele carimbo removeu, e nada removido antes. */
export async function restaurarVisualizacoesDoTitulo(
  titleId: string,
  removidoEm: Date,
  db: ClientePrisma = prisma,
): Promise<number> {
  return (
    await db.watch.updateMany({ where: { titleId, removedAt: removidoEm }, data: { removedAt: null } })
  ).count;
}

// ── leitura ──────────────────────────────────────────────────

export async function visualizacoesDoTitulo(titleId: string): Promise<VisualizacaoDoTitulo[]> {
  const linhas = await prisma.watch.findMany({
    where: { titleId, removedAt: null },
    orderBy: [{ watchedOn: 'desc' }, { createdAt: 'desc' }],
    select: SELECAO,
  });
  return linhas.map(formatar);
}

/** A pessoa estava em alguma visualização ativa deste filme? */
export async function participouDe(
  titleId: string,
  pessoa: Pessoa,
  db: ClientePrisma = prisma,
): Promise<boolean> {
  const achada = await db.watch.findFirst({
    where: { titleId, removedAt: null, participants: { has: pessoa } },
    select: { id: true },
  });
  return achada !== null;
}

const LIMITE_PADRAO = 60;

/** Cursor opaco: data + id da última linha da página anterior. */
function lerCursor(cursor: string): { watchedOn: Date; id: string } {
  try {
    const [dia, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const watchedOn = new Date(`${dia}T00:00:00Z`);
    if (!id || Number.isNaN(watchedOn.getTime())) throw new Error();
    return { watchedOn, id };
  } catch {
    throw new ValidationError('Cursor inválido.');
  }
}

function escreverCursor(w: { watchedOn: Date; id: string }): string {
  return Buffer.from(`${w.watchedOn.toISOString().slice(0, 10)}|${w.id}`).toString('base64url');
}

/**
 * A tela "Assistidos" (§8): mais recentes primeiro, com filtros e paginação
 * por cursor — o acervo vai ter centenas de linhas, e `OFFSET` pula ou repete
 * itens quando alguém registra um filme no meio da rolagem.
 */
export async function listarVisualizacoes(
  filtros: FiltrosDeVisualizacoes,
): Promise<{ itens: VisualizacaoDaLista[]; proximoCursor: string | null }> {
  const limite = Math.min(Math.max(filtros.limite ?? LIMITE_PADRAO, 1), 200);
  const cursor = filtros.cursor ? lerCursor(filtros.cursor) : null;

  const where: Prisma.WatchWhereInput = {
    removedAt: null,
    title: {
      status: { not: 'merged' },
      ...(filtros.q
        ? {
            OR: [
              { title: { contains: filtros.q, mode: 'insensitive' } },
              { originalTitle: { contains: filtros.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    ...(filtros.pessoa === 'AMBOS'
      ? { participants: { hasEvery: ['CAT', 'BEAR'] } }
      : filtros.pessoa
        ? { participants: { has: filtros.pessoa } }
        : {}),
    ...(filtros.local ? { location: filtros.local } : {}),
    ...(filtros.ano
      ? {
          watchedOn: {
            gte: new Date(Date.UTC(filtros.ano, 0, 1)),
            lt: new Date(Date.UTC(filtros.ano + 1, 0, 1)),
          },
        }
      : {}),
    ...(cursor
      ? {
          OR: [
            { watchedOn: { lt: cursor.watchedOn } },
            { watchedOn: cursor.watchedOn, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };

  const linhas = await prisma.watch.findMany({
    where,
    orderBy: [{ watchedOn: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    select: {
      ...SELECAO,
      title: { select: { id: true, title: true, posterUrl: true, year: true } },
    },
  });

  const temMais = linhas.length > limite;
  const pagina = temMais ? linhas.slice(0, limite) : linhas;

  return {
    itens: pagina.map((w) => ({
      ...formatar(w),
      titulo: { id: w.title.id, titulo: w.title.title, posterUrl: w.title.posterUrl, ano: w.title.year },
    })),
    proximoCursor: temMais ? escreverCursor(pagina[pagina.length - 1]!) : null,
  };
}
