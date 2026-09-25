import { createApp } from './app';
import { env, missingOptionalKeys } from './config/env';
import { iniciarAgendador, pararAgendador } from './modules/sync';
import { disconnectPrisma } from './shared/prisma';
import { logger } from './shared/logger';

const log = logger.child({ module: 'server' });

const app = createApp();

const server = app.listen(env.PORT, () => {
  log.info('backend no ar', { port: env.PORT, env: env.NODE_ENV });

  const agendador = iniciarAgendador();
  log.info('agendador', agendador);

  const faltando = missingOptionalKeys();
  if (faltando.length > 0) {
    // avisa alto: o app sobe, mas os jobs que dependem destas chaves vão falhar
    log.warn('variáveis de ambiente ausentes — os jobs que dependem delas não vão rodar', {
      faltando,
    });
  }
});

async function desligar(sinal: string): Promise<void> {
  log.info('desligando', { sinal });

  pararAgendador();

  server.close(async (erro) => {
    if (erro) log.error('erro ao fechar o servidor HTTP', { erro });
    await disconnectPrisma();
    process.exit(erro ? 1 : 0);
  });

  // se alguma conexão travar, não fica pendurado para sempre
  setTimeout(() => {
    log.warn('desligamento forçado: conexões não fecharam a tempo');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => void desligar('SIGINT'));
process.on('SIGTERM', () => void desligar('SIGTERM'));

process.on('unhandledRejection', (motivo) => {
  log.error('promise rejeitada sem tratamento', { motivo });
});

process.on('uncaughtException', (erro) => {
  log.error('exceção não capturada', { erro });
  process.exit(1);
});
