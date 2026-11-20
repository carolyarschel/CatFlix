import { Prisma, type Pessoa, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import { rotuloDeAudio, rotuloDeSala } from '../catalog/catalog.format';
import { fusoDaCidade } from '../cinemas';

/**
 * Ingresso comprado (pedido de 20/11/2026): para um filme em cartaz, a sessão
 * escolhida na grade do ingresso.com e os códigos de resgate.
 *
 * É do casal: os dois veem e editam, e o lembrete 30 minutos antes vai para os
 * aparelhos das duas contas (`tickets.lembrete.ts`). Quem cadastrou fica
 * registrado, mas não manda em nada.
 *
 * Um ingresso por sessão. Um segundo ingresso para a mesma sessão é só mais um
 * código no mesmo registro — duas linhas seriam dois lembretes iguais.
 */

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

export const MAXIMO_DE_CODIGOS = 10;
export const TAMANHO_MAXIMO_DO_CODIGO = 120;

/**
 * Até quando o ingresso aparece depois de a sessão começar. Cobre o filme
 * inteiro (e o trailer): o código ainda pode ser pedido na porta da sala.
 */
const VISIVEL_DEPOIS_DO_INICIO_MS = 4 * 60 * 60 * 1000;

export interface IngressoComprado {
  id: string;
  titleId: string;
  /** `null` quando a sessão sumiu da base; a cópia abaixo continua valendo */
  sessaoId: string | null;
  inicio: Date;
  /** `AAAA-MM-DD` no fuso da cidade */
  dia: string;
  /** "19h40" no fuso da cidade */
  horario: string;
  cinema: string;
  /** "Sala 7 · IMAX · Legendado" */
  detalhes: string | null;
  codigos: string[];
  cadastradoPor: Pessoa;
  lembreteEnviadoEm: Date | null;
}

/**
 * Espaços nas pontas saem, linhas vazias somem e o código repetido aparece uma
 * vez só, na ordem em que foi digitado.
 */
export function limparCodigos(codigos: string[]): string[] {
  const vistos = new Set<string>();
  const limpos: string[] = [];

  for (const bruto of codigos) {
    const codigo = bruto.trim();
    if (!codigo || vistos.has(codigo)) continue;
    if (codigo.length > TAMANHO_MAXIMO_DO_CODIGO) {
      throw new ValidationError(`Um código passa de ${TAMANHO_MAXIMO_DO_CODIGO} caracteres.`);
    }
    vistos.add(codigo);
    limpos.push(codigo);
  }

  if (limpos.length > MAXIMO_DE_CODIGOS) {
    throw new ValidationError(`No máximo ${MAXIMO_DE_CODIGOS} códigos por ingresso.`);
  }
  return limpos;
}

/** "Sala 7 · IMAX · 3D · Legendado" — o que a pessoa procura na porta. */
function detalhesDaSessao(s: { roomName: string | null; roomType: string; is3d: boolean; audio: string }): string | null {
  const partes = [
    s.roomName,
    s.roomType && s.roomType !== 'normal' ? rotuloDeSala(s.roomType) : null,
    s.is3d ? '3D' : null,
    s.audio !== 'desconhecido' ? rotuloDeAudio(s.audio) : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** A cópia da sessão que o ingresso guarda. Só sessão futura, e deste filme. */
async function copiaDaSessao(db: ClientePrisma, sessaoId: string, titleId: string, agora: Date) {
  const sessao = await db.session.findUnique({
    where: { id: sessaoId },
    select: {
      titleId: true,
      startsAt: true,
      roomName: true,
      roomType: true,
      is3d: true,
      audio: true,
      cinema: { select: { name: true } },
    },
  });

  if (!sessao) throw new NotFoundError('Essa sessão não existe mais. Escolha outra.');
  if (sessao.titleId !== titleId) throw new ValidationError('Essa sessão é de outro filme.');
  if (sessao.startsAt.getTime() <= agora.getTime()) throw new ValidationError('Essa sessão já começou.');

  return {
    startsAt: sessao.startsAt,
    cinemaName: sessao.cinema.name,
    details: detalhesDaSessao(sessao),
  };
}

function partesNoFuso(data: Date, fuso: string) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value]),
  );
  return { dia: `${partes.year}-${partes.month}-${partes.day}`, horario: `${partes.hour}h${partes.minute}` };
}

const SELECAO = {
  id: true,
  titleId: true,
  sessionId: true,
  startsAt: true,
  cinemaName: true,
  details: true,
  codes: true,
  createdBy: true,
  reminderSentAt: true,
} as const;

type IngressoCru = Prisma.TicketGetPayload<{ select: typeof SELECAO }>;

export function formatarIngresso(t: IngressoCru, fuso: string): IngressoComprado {
  return {
    id: t.id,
    titleId: t.titleId,
    sessaoId: t.sessionId,
    inicio: t.startsAt,
    ...partesNoFuso(t.startsAt, fuso),
    cinema: t.cinemaName,
    detalhes: t.details,
    codigos: t.codes,
    cadastradoPor: t.createdBy,
    lembreteEnviadoEm: t.reminderSentAt,
  };
}

/** Os ingressos de um filme que ainda servem: sessão futura ou em andamento. */
export async function ingressosDoTitulo(titleId: string, agora = new Date()): Promise<IngressoComprado[]> {
  const [linhas, fuso] = await Promise.all([
    prisma.ticket.findMany({
      where: { titleId, startsAt: { gte: new Date(agora.getTime() - VISIVEL_DEPOIS_DO_INICIO_MS) } },
      orderBy: { startsAt: 'asc' },
      select: SELECAO,
    }),
    fusoDaCidade(),
  ]);
  return linhas.map((t) => formatarIngresso(t, fuso));
}

function ehSessaoRepetida(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}

const JA_TEM_INGRESSO = 'Já tem ingresso cadastrado para essa sessão. Edite o que existe para acrescentar códigos.';

export async function cadastrarIngresso(
  titleId: string,
  pessoa: Pessoa,
  dados: { sessaoId: string; codigos: string[] },
  agora = new Date(),
): Promise<IngressoComprado> {
  const codigos = limparCodigos(dados.codigos);

  const titulo = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true } });
  if (!titulo) throw new NotFoundError(`Título "${titleId}" não existe.`);

  const copia = await copiaDaSessao(prisma, dados.sessaoId, titleId, agora);

  try {
    const linha = await prisma.ticket.create({
      data: { titleId, sessionId: dados.sessaoId, ...copia, codes: codigos, createdBy: pessoa },
      select: SELECAO,
    });
    return formatarIngresso(linha, await fusoDaCidade());
  } catch (erro) {
    if (ehSessaoRepetida(erro)) throw new ConflictError(JA_TEM_INGRESSO);
    throw erro;
  }
}

/**
 * Troca os códigos e/ou a sessão. Trocar de sessão rearma o lembrete: o que já
 * saiu era o da sessão antiga.
 */
export async function editarIngresso(
  id: string,
  dados: { sessaoId?: string; codigos?: string[] },
  agora = new Date(),
): Promise<IngressoComprado> {
  const atual = await prisma.ticket.findUnique({ where: { id }, select: { titleId: true, sessionId: true } });
  if (!atual) throw new NotFoundError('Esse ingresso não existe mais.');

  const data: Prisma.TicketUncheckedUpdateInput = {};
  if (dados.codigos) data.codes = limparCodigos(dados.codigos);
  if (dados.sessaoId && dados.sessaoId !== atual.sessionId) {
    Object.assign(data, await copiaDaSessao(prisma, dados.sessaoId, atual.titleId, agora));
    data.sessionId = dados.sessaoId;
    data.reminderSentAt = null;
  }

  try {
    const linha = await prisma.ticket.update({ where: { id }, data, select: SELECAO });
    return formatarIngresso(linha, await fusoDaCidade());
  } catch (erro) {
    if (ehSessaoRepetida(erro)) throw new ConflictError(JA_TEM_INGRESSO);
    throw erro;
  }
}

export async function removerIngresso(id: string): Promise<void> {
  const { count } = await prisma.ticket.deleteMany({ where: { id } });
  if (count === 0) throw new NotFoundError('Esse ingresso não existe mais.');
}
