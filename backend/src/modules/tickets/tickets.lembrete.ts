import cron, { type ScheduledTask } from 'node-cron';
import { cronHabilitado } from '../../config/env';
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { enviarParaPerfis, type ConteudoDoPush } from '../canaries';
import { fusoDaCidade } from '../cinemas';
import { formatarIngresso } from './tickets.service';

const log = logger.child({ module: 'tickets:lembrete' });

/**
 * O lembrete do ingresso: um push para os aparelhos das duas contas 30
 * minutos antes da sessão, com os códigos de resgate.
 *
 * Roda a cada minuto e manda tudo o que entrou na janela e ainda não saiu. Por
 * isso:
 * - ingresso cadastrado a 10 minutos da sessão recebe o lembrete no minuto
 *   seguinte, em vez de nunca;
 * - se o servidor ficou fora na hora certa, o lembrete sai quando ele voltar,
 *   desde que a sessão não tenha começado.
 */
export const ANTECEDENCIA_DO_LEMBRETE_MS = 30 * 60 * 1000;

export function conteudoDoLembrete(
  ingresso: { id: string; titleId: string; startsAt: Date; cinema: string; horario: string; detalhes: string | null; codigos: string[] },
  tituloDoFilme: string,
  agora: Date,
): ConteudoDoPush {
  const minutos = Math.max(1, Math.round((ingresso.startsAt.getTime() - agora.getTime()) / 60_000));

  const onde = [ingresso.horario, ingresso.cinema, ingresso.detalhes].filter(Boolean).join(' · ');
  const codigos =
    ingresso.codigos.length === 0
      ? 'Nenhum código de resgate cadastrado.'
      : ingresso.codigos.length === 1
        ? `Código: ${ingresso.codigos[0]}`
        : `Códigos: ${ingresso.codigos.join(' · ')}`;

  return {
    title: `🎟️ ${tituloDoFilme} começa em ${minutos} min`,
    body: `${onde}\n${codigos}`,
    // um lembrete por ingresso: reenviar (sessão trocada) substitui o anterior
    tag: `ingresso-${ingresso.id}`,
    url: `/filme/${ingresso.titleId}`,
    data: { ingressoId: ingresso.id },
  };
}

/** As duas contas do casal: os perfis que têm papel (CAT/BEAR). */
async function perfisDoCasal(): Promise<string[]> {
  const usuarios = await prisma.user.findMany({ where: { papel: { not: null } }, select: { id: true } });
  return usuarios.map((u) => u.id);
}

/**
 * Manda os lembretes que venceram. Devolve quantos ingressos foram avisados.
 * `enviar` é trocável para os testes não mandarem push de verdade.
 */
export async function enviarLembretesPendentes(
  agora = new Date(),
  enviar: typeof enviarParaPerfis = enviarParaPerfis,
): Promise<number> {
  const devidos = await prisma.ticket.findMany({
    where: {
      reminderSentAt: null,
      startsAt: { gt: agora, lte: new Date(agora.getTime() + ANTECEDENCIA_DO_LEMBRETE_MS) },
    },
    select: {
      id: true,
      titleId: true,
      sessionId: true,
      startsAt: true,
      cinemaName: true,
      details: true,
      codes: true,
      createdBy: true,
      reminderSentAt: true,
      title: { select: { title: true } },
    },
  });
  if (devidos.length === 0) return 0;

  const [fuso, perfis] = await Promise.all([fusoDaCidade(), perfisDoCasal()]);
  let avisados = 0;

  for (const linha of devidos) {
    // Reivindica antes de mandar: duas rodadas sobrepostas (ou dois processos)
    // não mandam o mesmo lembrete duas vezes.
    const { count } = await prisma.ticket.updateMany({
      where: { id: linha.id, reminderSentAt: null },
      data: { reminderSentAt: agora },
    });
    if (count === 0) continue;

    const ingresso = formatarIngresso(linha, fuso);
    const conteudo = conteudoDoLembrete(
      { ...ingresso, startsAt: linha.startsAt },
      linha.title.title,
      agora,
    );

    try {
      const r = await enviar(perfis, conteudo, {
        // o serviço de push não segura a mensagem além do começo da sessão
        ttl: Math.max(60, Math.round((linha.startsAt.getTime() - agora.getTime()) / 1000)),
      });

      // Nenhum aparelho recebeu, mas houve falha: devolve para tentar de novo
      // no próximo minuto. Sem aparelho inscrito não é falha — não há para
      // onde mandar, e tentar a cada minuto não mudaria isso.
      if (r.enviados === 0 && r.falhas > 0) throw new Error(`push falhou em ${r.falhas} aparelho(s)`);

      avisados += 1;
      log.info('lembrete de ingresso enviado', {
        ingresso: linha.id,
        enviados: r.enviados,
        semInscricao: r.semInscricao,
      });
    } catch (erro) {
      await prisma.ticket.updateMany({ where: { id: linha.id, reminderSentAt: agora }, data: { reminderSentAt: null } });
      log.error('lembrete de ingresso falhou; tenta de novo no próximo minuto', { ingresso: linha.id, erro });
    }
  }

  return avisados;
}

let tarefa: ScheduledTask | null = null;
let rodando = false;

async function rodada(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    await enviarLembretesPendentes();
  } catch (erro) {
    log.error('rodada de lembretes de ingresso falhou', { erro });
  } finally {
    rodando = false;
  }
}

/**
 * Liga a checagem por minuto. Segue a mesma chave do agendador do sync
 * (`CRON_ENABLED`): em desenvolvimento fica desligada, para o banco local não
 * mandar push para o celular de verdade.
 */
export function iniciarLembretesDeIngresso(): boolean {
  if (!cronHabilitado) return false;
  tarefa = cron.schedule('* * * * *', () => void rodada());
  void rodada();
  return true;
}

export function pararLembretesDeIngresso(): void {
  void tarefa?.stop();
  tarefa = null;
}
