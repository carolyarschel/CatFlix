import cron, { type ScheduledTask } from 'node-cron';
import { cronHabilitado, env } from '../../config/env';
import { isAppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { rodarJob } from './sync.service';

const log = logger.child({ module: 'sync:cron' });

/**
 * Agenda dos jobs (§9).
 *
 * Horários escolhidos para pegar a grade já publicada e ficar longe do pico do
 * site: o ingresso costuma publicar a programação da semana na quarta de
 * madrugada, e as sessões do dia mudam ao longo da manhã.
 *
 * O fuso vem da cidade, não do servidor: no Catploy o processo pode rodar em
 * UTC, e "3× ao dia" tem de significar três vezes no dia da Carol.
 */
const AGENDA: Array<{ nome: string; expressao: string; descricao: string }> = [
  {
    nome: 'sessoes',
    expressao: '0 6,13,20 * * *',
    descricao: '3× ao dia: manhã, tarde e noite',
  },
  {
    nome: 'proximos',
    expressao: '30 5 * * *',
    descricao: '1× ao dia, antes do primeiro sync de sessões',
  },
  {
    nome: 'metadata',
    expressao: '0 4 * * *',
    descricao: '1× ao dia; só mexe no que passou de 30 dias',
  },
  {
    nome: 'notas',
    expressao: '30 4 * * *',
    descricao: '1× ao dia; a cadência real por filme está na §5.3',
  },
];

const TIMEZONE = 'America/Sao_Paulo';

let tarefas: ScheduledTask[] = [];

export function iniciarAgendador(): { agendados: number; habilitado: boolean } {
  if (!cronHabilitado) {
    log.info('agendador desligado (CRON_ENABLED)', { env: env.NODE_ENV });
    return { agendados: 0, habilitado: false };
  }

  for (const item of AGENDA) {
    if (!cron.validate(item.expressao)) {
      // expressão inválida é erro de programação: falhar no boot é melhor que
      // descobrir em três dias que um job nunca rodou
      throw new Error(`Expressão de cron inválida para "${item.nome}": ${item.expressao}`);
    }

    const tarefa = cron.schedule(
      item.expressao,
      () => {
        void executarComSeguranca(item.nome);
      },
      { timezone: TIMEZONE },
    );

    tarefas.push(tarefa);
    log.info('job agendado', { job: item.nome, quando: item.expressao, fuso: TIMEZONE });
  }

  return { agendados: tarefas.length, habilitado: true };
}

/**
 * O cron não espera promise: uma rejeição aqui viraria `unhandledRejection` e
 * poderia derrubar o processo inteiro por causa de um sync que falhou.
 */
async function executarComSeguranca(nome: string): Promise<void> {
  try {
    await rodarJob(nome);
  } catch (erro) {
    // já existe um sync deste tipo rodando: não é falha, é a proteção agindo
    if (isAppError(erro) && erro.code === 'CONFLICT') {
      log.warn('job pulado: já havia um rodando', { job: nome, motivo: erro.message });
      return;
    }
    log.error('job agendado falhou fora do registro', { job: nome, erro });
  }
}

export function pararAgendador(): void {
  for (const tarefa of tarefas) void tarefa.stop();
  tarefas = [];
  log.info('agendador parado');
}

export function agendaAtual(): Array<{ nome: string; expressao: string; descricao: string; fuso: string }> {
  return AGENDA.map((a) => ({ ...a, fuso: TIMEZONE }));
}
