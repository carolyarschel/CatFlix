import type { AudioType, SessionKind } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { ValidationError } from '../../shared/errors';
// só formatação; não cria ciclo porque `catalog.format` não importa o catálogo
import { rotuloDeAudio, rotuloDeSala } from '../catalog/catalog.format';
import { fusoDaCidade } from './cinemas.service';

/**
 * Leitura de sessões (§10: `GET /sessions?titleId=&date=`).
 *
 * Agrupa por cinema, que é como a pessoa decide: primeiro escolhe onde vai,
 * depois que horas.
 */

export interface SessaoDoDia {
  id: string;
  inicio: Date;
  /** "19h40", já no fuso da cidade */
  horario: string;
  /** dia no fuso da cidade, "2026-09-24" — serve de chave para agrupar por dia */
  dia: string;
  sala: string | null;
  salaNome: string | null;
  audio: AudioType;
  audioRotulo: string | null;
  is3d: boolean;
  tipo: SessionKind;
  urlCompra: string | null;
}

export interface SessoesPorCinema {
  cinemaId: string;
  cinema: string;
  rede: string | null;
  sessoes: SessaoDoDia[];
}

/**
 * Deslocamento do fuso em minutos no instante dado.
 *
 * Feito a partir de `longOffset` ("GMT-03:00") em vez de subtrair datas
 * formatadas: o Brasil não tem horário de verão hoje, mas já teve, e uma conta
 * que só funciona sem DST é uma armadilha esperando o decreto voltar.
 */
function deslocamentoEmMinutos(referencia: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    timeZoneName: 'longOffset',
  }).formatToParts(referencia);

  const nome = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const casado = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  if (!casado) return 0;

  const sinal = casado[1] === '-' ? -1 : 1;
  return sinal * (Number(casado[2]) * 60 + Number(casado[3]));
}

/** Meia-noite local de um dia `YYYY-MM-DD`, como instante UTC. */
function inicioDoDia(dia: string, fuso: string): Date {
  const casado = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!casado) {
    throw new ValidationError(`Data inválida: "${dia}". Use o formato AAAA-MM-DD.`);
  }

  const meiaNoiteUtc = Date.UTC(Number(casado[1]), Number(casado[2]) - 1, Number(casado[3]));
  // o deslocamento é medido ao meio-dia local para não cair na hora que o
  // relógio pula quando existe horário de verão
  const deslocamento = deslocamentoEmMinutos(new Date(meiaNoiteUtc + 12 * 3_600_000), fuso);

  return new Date(meiaNoiteUtc - deslocamento * 60_000);
}

function partesNoFuso(data: Date, fuso: string): Record<string, string> {
  const formatador = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return Object.fromEntries(formatador.formatToParts(data).map((p) => [p.type, p.value]));
}

export async function listarSessoes(opcoes: {
  titleId?: string;
  cinemaId?: string;
  /** dia no fuso da cidade, AAAA-MM-DD */
  dia?: string;
}): Promise<SessoesPorCinema[]> {
  if (!opcoes.titleId && !opcoes.cinemaId) {
    throw new ValidationError('Informe titleId ou cinemaId.');
  }

  const fuso = await fusoDaCidade();

  const inicio = opcoes.dia ? inicioDoDia(opcoes.dia, fuso) : new Date();
  const fim = opcoes.dia ? new Date(inicio.getTime() + 86_400_000) : null;

  const sessoes = await prisma.session.findMany({
    where: {
      active: true,
      ...(opcoes.titleId ? { titleId: opcoes.titleId } : {}),
      ...(opcoes.cinemaId ? { cinemaId: opcoes.cinemaId } : {}),
      startsAt: fim ? { gte: inicio, lt: fim } : { gte: inicio },
    },
    orderBy: [{ startsAt: 'asc' }],
    select: {
      id: true,
      startsAt: true,
      roomType: true,
      roomName: true,
      audio: true,
      is3d: true,
      sessionKind: true,
      purchaseUrl: true,
      cinema: { select: { id: true, name: true, chain: true } },
    },
  });

  const porCinema = new Map<string, SessoesPorCinema>();

  for (const sessao of sessoes) {
    const grupo = porCinema.get(sessao.cinema.id) ?? {
      cinemaId: sessao.cinema.id,
      cinema: sessao.cinema.name,
      rede: sessao.cinema.chain,
      sessoes: [],
    };

    const p = partesNoFuso(sessao.startsAt, fuso);

    grupo.sessoes.push({
      id: sessao.id,
      inicio: sessao.startsAt,
      horario: `${p.hour}h${p.minute}`,
      dia: `${p.year}-${p.month}-${p.day}`,
      // "normal" não é sala: mostrar "Normal" no detalhe só ocuparia espaço
      sala: sessao.roomType && sessao.roomType !== 'normal' ? rotuloDeSala(sessao.roomType) : null,
      salaNome: sessao.roomName,
      audio: sessao.audio,
      audioRotulo: sessao.audio === 'desconhecido' ? null : rotuloDeAudio(sessao.audio),
      is3d: sessao.is3d,
      tipo: sessao.sessionKind,
      urlCompra: sessao.purchaseUrl,
    });

    porCinema.set(sessao.cinema.id, grupo);
  }

  return [...porCinema.values()].sort((a, b) => a.cinema.localeCompare(b.cinema, 'pt-BR'));
}

/** Cinemas ativos da cidade — alimenta o filtro por cinema do painel de tags. */
export async function listarCinemas(): Promise<
  Array<{ id: string; ingressoId: string; nome: string; rede: string | null }>
> {
  const cinemas = await prisma.cinema.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, ingressoId: true, name: true, chain: true },
  });

  return cinemas.map((c) => ({
    id: c.id,
    ingressoId: c.ingressoId,
    nome: c.name,
    rede: c.chain,
  }));
}
