import type { AvailabilityStatus } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { CinemaNormalizado, SessaoNormalizada } from '../ingresso';

const log = logger.child({ module: 'cinemas' });

/**
 * Cinemas, sessões e disponibilidade.
 *
 * Regra que atravessa o módulo inteiro: **nada é apagado.** Sessão que sumiu
 * da API vira `active = false`, cinema que sumiu idem. Isso existe porque a
 * ausência de um dado pode significar duas coisas muito diferentes — "a sessão
 * acabou mesmo" ou "a API está com problema" — e apagar torna as duas
 * indistinguíveis depois. Com `lastSeenAt`, o canary semântico consegue ver a
 * diferença (§8).
 */

export async function sincronizarCinemas(
  cinemas: CinemaNormalizado[],
  opcoes: { timezonePorCidade?: Map<string, string> } = {},
): Promise<{ criados: number; atualizados: number; desativados: number }> {
  const agora = new Date();
  let criados = 0;
  let atualizados = 0;

  for (const cinema of cinemas) {
    const timezone = cinema.cityId ? opcoes.timezonePorCidade?.get(cinema.cityId) : undefined;

    const existente = await prisma.cinema.findUnique({
      where: { ingressoId: cinema.ingressoId },
      select: { id: true },
    });

    await prisma.cinema.upsert({
      where: { ingressoId: cinema.ingressoId },
      update: {
        name: cinema.name,
        chain: cinema.chain,
        address: cinema.address,
        cityName: cinema.cityName,
        cityId: cinema.cityId,
        ...(timezone ? { timezone } : {}),
        active: cinema.enabled,
        lastSeenAt: agora,
      },
      create: {
        ingressoId: cinema.ingressoId,
        name: cinema.name,
        chain: cinema.chain,
        address: cinema.address,
        cityName: cinema.cityName,
        cityId: cinema.cityId,
        ...(timezone ? { timezone } : {}),
        active: cinema.enabled,
        lastSeenAt: agora,
      },
    });

    if (existente) atualizados += 1;
    else criados += 1;
  }

  // cinema que a API parou de listar: desativa, não apaga — as sessões
  // históricas dele continuam fazendo sentido
  const vistos = cinemas.map((c) => c.ingressoId);
  const desativados = vistos.length
    ? (
        await prisma.cinema.updateMany({
          where: { ingressoId: { notIn: vistos }, active: true },
          data: { active: false },
        })
      ).count
    : 0;

  log.info('cinemas sincronizados', { criados, atualizados, desativados });
  return { criados, atualizados, desativados };
}

export interface ResultadoDasSessoes {
  gravadas: number;
  desativadas: number;
  semTitle: number;
}

/**
 * Grava as sessões de um cinema.
 *
 * `ingressoSessionId` é a chave natural, o que torna a operação idempotente:
 * rodar o mesmo sync três vezes no dia não duplica nada.
 *
 * `titleIdPorEvento` vem do matching: o módulo de cinemas não sabe casar
 * filme, só sabe onde e quando ele passa.
 */
export async function sincronizarSessoes(
  cinemaIngressoId: string,
  sessoes: SessaoNormalizada[],
  titleIdPorEvento: Map<string, string>,
): Promise<ResultadoDasSessoes> {
  const cinema = await prisma.cinema.findUnique({
    where: { ingressoId: cinemaIngressoId },
    select: { id: true },
  });

  if (!cinema) {
    log.warn('sessões de um cinema que não está no banco', { cinemaIngressoId });
    return { gravadas: 0, desativadas: 0, semTitle: sessoes.length };
  }

  const agora = new Date();
  const idsVistos: string[] = [];
  let gravadas = 0;
  let semTitle = 0;

  for (const sessao of sessoes) {
    const titleId = titleIdPorEvento.get(sessao.eventIngressoId);

    if (!titleId) {
      // não deveria acontecer: o matching garante um Title para todo evento.
      // Se acontecer, a sessão é PULADA e contada — nunca ligada ao Title errado.
      semTitle += 1;
      continue;
    }

    const dados = {
      titleId,
      cinemaId: cinema.id,
      startsAt: sessao.startsAt,
      roomType: sessao.roomType,
      roomLabel: sessao.roomLabel,
      roomName: sessao.roomName,
      audio: sessao.audio,
      is3d: sessao.is3d,
      sessionKind: sessao.sessionKind,
      purchaseUrl: sessao.purchaseUrl,
      active: sessao.enabled,
      lastSeenAt: agora,
    };

    await prisma.session.upsert({
      where: { ingressoSessionId: sessao.ingressoSessionId },
      update: dados,
      create: { ingressoSessionId: sessao.ingressoSessionId, ...dados },
    });

    idsVistos.push(sessao.ingressoSessionId);
    gravadas += 1;
  }

  // sessões deste cinema que não vieram no payload: saíram da grade
  const desativadas = (
    await prisma.session.updateMany({
      where: {
        cinemaId: cinema.id,
        active: true,
        ...(idsVistos.length ? { ingressoSessionId: { notIn: idsVistos } } : {}),
      },
      data: { active: false },
    })
  ).count;

  if (semTitle > 0) {
    log.warn('sessões sem Title correspondente foram puladas', { cinemaIngressoId, semTitle });
  }

  return { gravadas, desativadas, semTitle };
}

/**
 * Disponibilidade por fonte (§6).
 *
 * `Availability` é o que a FONTE diz — "está em cartaz" —, e é separado de
 * `UserTitleState`, que é o que a Carol diz — "quero ver". Misturar os dois
 * significaria que um filme sair de cartaz apagaria a marcação dela.
 */
export async function marcarDisponibilidade(
  titleIds: Iterable<string>,
  status: AvailabilityStatus,
): Promise<number> {
  const agora = new Date();
  const todos = [...new Set(titleIds)];

  // nem "em breve" nem "pré-estreia" se abrem para quem já estreou
  // — ver `EM_CARTAZ_GANHA_DOS_FUTUROS`
  const jaEmCartaz = ANTES_DA_ESTREIA.includes(status as (typeof ANTES_DA_ESTREIA)[number])
    ? await idsComCartazAberto(todos)
    : new Set<string>();

  let marcados = 0;

  for (const titleId of todos) {
    if (jaEmCartaz.has(titleId)) continue;

    await prisma.availability.upsert({
      where: { titleId_source_status: { titleId, source: 'cinema', status } },
      update: { lastSeenAt: agora, endedAt: null },
      create: { titleId, source: 'cinema', status, firstSeenAt: agora, lastSeenAt: agora },
    });
    marcados += 1;
  }

  if (status === 'em_cartaz' || ANTES_DA_ESTREIA.includes(status as (typeof ANTES_DA_ESTREIA)[number])) {
    await fecharFuturosDeQuemEstaEmCartaz(todos);
  }

  return marcados;
}

/**
 * Os dois estados que só fazem sentido ANTES da estreia.
 *
 * Um filme já em cartaz não está "em breve" nem em "pré-estreia": ele estreou.
 */
const ANTES_DA_ESTREIA = ['em_breve', 'pre_estreia'] as const;

/**
 * EM_CARTAZ_GANHA_DOS_FUTUROS — a regra que impede um filme de estar em duas
 * trilhas da home ao mesmo tempo.
 *
 * O problema que ela resolve (medido em 24/09/2026): `sessoes` abre `em_cartaz`
 * às 06h/13h/20h, `proximos` abre `em_breve` e `pre_estreia` às 05h30, cada um
 * lendo sua lista no ingresso — e **nenhum fechava a do outro**. Sete títulos
 * visíveis tinham `em_cartaz + em_breve` e outros sete `em_cartaz +
 * pre_estreia`; *Digger* e *Se Eu Fosse Você 3* apareciam de fato em duas
 * trilhas.
 *
 * Por que a regra mora aqui, no ponto de escrita, e não no job: senão ela
 * dependeria de quem roda primeiro. O `proximos` das 05h30 reabriria todo dia o
 * que o `sessoes` das 20h fechou, e a home ficaria errada das 05h30 às 06h. Nos
 * dois sentidos, o mesmo ponto decide.
 *
 * Fecha com `endedAt` em vez de apagar, como `encerrarDisponibilidadeAusente`:
 * "este filme esteve anunciado como pré-estreia até tal dia" continua
 * respondível.
 *
 * ⚠️ Isto conserta a DISPONIBILIDADE, que é o que a home e os filtros usam. O
 * campo `Session.sessionKind` continua torto por outro motivo (vem de
 * `inPreSale`, que é pré-venda) — é a pendência 1 do README, e por isso o
 * detalhe do filme não mostra o tipo da sessão.
 */
async function idsComCartazAberto(titleIds: string[]): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();

  const abertas = await prisma.availability.findMany({
    where: { titleId: { in: titleIds }, source: 'cinema', status: 'em_cartaz', endedAt: null },
    select: { titleId: true },
  });

  return new Set(abertas.map((a) => a.titleId));
}

/** Fecha `em_breve` e `pre_estreia` de quem, entre estes títulos, já está em cartaz. */
async function fecharFuturosDeQuemEstaEmCartaz(titleIds: string[]): Promise<number> {
  const emCartaz = await idsComCartazAberto(titleIds);
  if (emCartaz.size === 0) return 0;

  const { count } = await prisma.availability.updateMany({
    where: {
      titleId: { in: [...emCartaz] },
      source: 'cinema',
      status: { in: [...ANTES_DA_ESTREIA] },
      endedAt: null,
    },
    data: { endedAt: new Date() },
  });

  if (count > 0) log.info('disponibilidade futura fechada: o filme já estreou', { count });
  return count;
}

/**
 * Fecha a disponibilidade de quem não apareceu nesta rodada.
 *
 * Usa `endedAt` em vez de apagar a linha: assim dá para responder "quando este
 * filme saiu de cartaz?", e o histórico não some.
 */
export async function encerrarDisponibilidadeAusente(
  titleIdsPresentes: Set<string>,
  status: AvailabilityStatus,
): Promise<number> {
  const abertas = await prisma.availability.findMany({
    where: { source: 'cinema', status, endedAt: null },
    select: { id: true, titleId: true },
  });

  const paraEncerrar = abertas.filter((a) => !titleIdsPresentes.has(a.titleId)).map((a) => a.id);
  if (paraEncerrar.length === 0) return 0;

  const { count } = await prisma.availability.updateMany({
    where: { id: { in: paraEncerrar } },
    data: { endedAt: new Date() },
  });

  log.info('disponibilidades encerradas', { status, count });
  return count;
}

/**
 * Quantas horas tem o dado mais novo desta cidade — alimenta o modo degradado
 * do §8 ("dados de X horas atrás").
 */
export async function idadeDosDadosEmHoras(): Promise<number | null> {
  const maisRecente = await prisma.session.findFirst({
    orderBy: { lastSeenAt: 'desc' },
    select: { lastSeenAt: true },
  });

  if (!maisRecente) return null;
  return (Date.now() - maisRecente.lastSeenAt.getTime()) / 3_600_000;
}

/**
 * Fuso da cidade, lido dos cinemas (o ingresso devolve o `timeZone` junto com a
 * cidade — ver CONTRATO.md §4.2).
 *
 * Existe para a formatação de horário não assumir cidade nenhuma no código
 * (§3): o app é de Campinas hoje porque `INGRESSO_CITY_ID=14`, não porque
 * alguém escreveu "America/Sao_Paulo" numa tela.
 *
 * Em cache de processo: muda quando a cidade muda, e a cidade não muda sem
 * reiniciar o backend.
 */
let fusoEmCache: string | null = null;

export async function fusoDaCidade(): Promise<string> {
  if (fusoEmCache) return fusoEmCache;

  const cinema = await prisma.cinema.findFirst({
    where: { active: true },
    select: { timezone: true },
  });

  fusoEmCache = cinema?.timezone ?? 'America/Sao_Paulo';
  return fusoEmCache;
}

/** Só para os testes: o cache de processo não pode vazar de um caso para outro. */
export function limparCacheDeFuso(): void {
  fusoEmCache = null;
}
