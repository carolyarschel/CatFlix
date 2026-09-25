import { PrismaClient } from '@prisma/client';
import { isProduction, isTest } from '../config/env';
import { logger } from './logger';

const log = logger.child({ module: 'prisma' });

function criarClient(): PrismaClient {
  const client = new PrismaClient({
    log: isProduction
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
  });

  client.$on('warn' as never, (evento: { message: string }) => {
    log.warn(evento.message);
  });

  client.$on('error' as never, (evento: { message: string }) => {
    log.error(evento.message);
  });

  if (!isProduction) {
    client.$on('query' as never, (evento: { query: string; duration: number }) => {
      // só consultas lentas: o sync faz muita query e o log vira ruído
      if (evento.duration >= 200) {
        log.debug('consulta lenta', { durationMs: evento.duration, query: evento.query });
      }
    });
  }

  return client;
}

/**
 * Singleton. Em dev o tsx recarrega o módulo a cada save; sem isto cada reload
 * abriria um novo pool e o Postgres estouraria o limite de conexões.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? criarClient();

if (!isProduction && !isTest) {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  log.info('conexão com o banco encerrada');
}
