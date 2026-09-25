import { afterAll, afterEach, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { agendaAtual } from './sync.scheduler';
import { jobsDisponiveis } from './sync.service';
import { executarJob, ultimasExecucoes } from './sync.runs';
import cron from 'node-cron';

let temBanco = false;
const criados: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterEach(async () => {
  if (!temBanco || criados.length === 0) return;
  await prisma.syncRun.deleteMany({ where: { id: { in: criados } } });
  criados.length = 0;
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

describe('ciclo de vida do SyncRun (§9)', () => {
  it('abre, conta e fecha como success', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await executarJob('manual', async (job) => {
      job.contagens.readCount = 10;
      job.contagens.matchedCount = 7;
      job.detalhes.observacao = 'teste';
      return 'pronto';
    });
    criados.push(r.syncRunId);

    expect(r.status).toBe('success');
    expect(r.resultado).toBe('pronto');

    const run = await prisma.syncRun.findUnique({ where: { id: r.syncRunId } });
    expect(run?.status).toBe('success');
    expect(run?.readCount).toBe(10);
    expect(run?.matchedCount).toBe(7);
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.details).toMatchObject({ observacao: 'teste' });
  });

  it('job que conta erro fecha como partial, não como sucesso', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    // um evento problemático no meio de 34 não pode fazer o sync parecer limpo
    const r = await executarJob('manual', async (job) => {
      job.contagens.readCount = 34;
      job.contagens.errorCount = 2;
    });
    criados.push(r.syncRunId);

    expect(r.status).toBe('partial');
  });

  it('job que lança ainda FECHA o registro, com a mensagem', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    // sem isto, uma falha de madrugada deixaria o registro aberto para sempre
    // e o /health/sync não teria como contar o que aconteceu
    const r = await executarJob('manual', async () => {
      throw new Error('a API caiu');
    });
    criados.push(r.syncRunId);

    expect(r.status).toBe('failed');

    const run = await prisma.syncRun.findUnique({ where: { id: r.syncRunId } });
    expect(run?.status).toBe('failed');
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.errorMessage).toBe('a API caiu');
  });

  it('recusa um segundo job do mesmo tipo enquanto o primeiro roda', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    let liberar: () => void = () => {};
    const travado = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const primeiro = executarJob('tags_rebuild', async () => {
      await travado;
    });

    // dá tempo do primeiro abrir o registro
    await new Promise((r) => setTimeout(r, 120));

    // o cron pode disparar em cima de um "Sincronizar agora" da Carol:
    // dois syncs do mesmo tipo ao mesmo tempo duplicariam requisição externa
    await expect(executarJob('tags_rebuild', async () => {})).rejects.toThrow(/já está rodando/);

    liberar();
    const r = await primeiro;
    criados.push(r.syncRunId);
  });

  it('deixa passar quando a concorrência é permitida de propósito', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const a = await executarJob('manual', async () => {}, { permitirConcorrencia: true });
    const b = await executarJob('manual', async () => {}, { permitirConcorrencia: true });
    criados.push(a.syncRunId, b.syncRunId);

    expect(a.status).toBe('success');
    expect(b.status).toBe('success');
  });

  it('guarda quem disparou', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const r = await executarJob('manual', async () => {}, { triggeredBy: 'catflix' });
    criados.push(r.syncRunId);

    const run = await prisma.syncRun.findUnique({ where: { id: r.syncRunId } });
    expect(run?.triggeredBy).toBe('catflix');
  });

  it('ultimasExecucoes traz uma linha por tipo, a mais recente', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const antiga = await executarJob('manual', async () => {}, { permitirConcorrencia: true });
    const nova = await executarJob('manual', async () => {}, { permitirConcorrencia: true });
    criados.push(antiga.syncRunId, nova.syncRunId);

    const linhas = await ultimasExecucoes();
    const manual = linhas.filter((l) => l.jobType === 'manual');
    expect(manual).toHaveLength(1);
  });
});

describe('agenda (§9)', () => {
  it('toda expressão de cron é válida', () => {
    for (const item of agendaAtual()) {
      expect(cron.validate(item.expressao), `${item.nome}: ${item.expressao}`).toBe(true);
    }
  });

  it('sessões roda 3× ao dia e próximos 1× ao dia', () => {
    const agenda = agendaAtual();
    const sessoes = agenda.find((a) => a.nome === 'sessoes');
    const proximos = agenda.find((a) => a.nome === 'proximos');

    // "0 6,13,20 * * *" → três horários
    expect(sessoes!.expressao.split(' ')[1]!.split(',')).toHaveLength(3);
    expect(proximos!.expressao.split(' ')[1]!.split(',')).toHaveLength(1);
  });

  it('usa o fuso da cidade, não o do servidor', () => {
    // no Catploy o processo pode rodar em UTC, e "3× ao dia" tem de significar
    // três vezes no dia da Carol
    for (const item of agendaAtual()) {
      expect(item.fuso).toBe('America/Sao_Paulo');
    }
  });

  it('todo job agendado existe de verdade', () => {
    const nomes = jobsDisponiveis().map((j) => j.nome);
    for (const item of agendaAtual()) {
      expect(nomes, `agenda aponta para job inexistente: ${item.nome}`).toContain(item.nome);
    }
  });
});
