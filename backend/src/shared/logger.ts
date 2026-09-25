import { env, isProduction } from '../config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const CORES: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

const limiar = LEVEL_ORDER[env.LOG_LEVEL];

function serializarErro(valor: unknown): unknown {
  if (valor instanceof Error) {
    return {
      name: valor.name,
      message: valor.message,
      stack: valor.stack,
      ...(valor.cause ? { cause: serializarErro(valor.cause) } : {}),
    };
  }
  return valor;
}

function prepararContexto(context: LogContext): LogContext {
  const saida: LogContext = {};
  for (const [chave, valor] of Object.entries(context)) {
    saida[chave] = valor instanceof Error ? serializarErro(valor) : valor;
  }
  return saida;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Cria um logger filho que carrega contexto fixo (ex.: { module: 'ingresso' }). */
  child(bindings: LogContext): Logger;
}

function criarLogger(bindings: LogContext = {}): Logger {
  function emitir(level: LogLevel, message: string, context: LogContext = {}): void {
    if (LEVEL_ORDER[level] < limiar) return;

    const registro = {
      time: new Date().toISOString(),
      level,
      message,
      ...prepararContexto({ ...bindings, ...context }),
    };

    const destino = level === 'error' || level === 'warn' ? console.error : console.log;

    if (isProduction) {
      // produção: uma linha JSON por evento, fácil de ler no Catploy
      destino(JSON.stringify(registro));
      return;
    }

    const { time, level: _nivel, message: _msg, ...resto } = registro;
    const hora = time.slice(11, 23);
    const extras = Object.keys(resto).length > 0 ? ` ${JSON.stringify(resto)}` : '';
    destino(`${CORES[level]}${hora} ${level.toUpperCase().padEnd(5)}${RESET} ${message}${extras}`);
  }

  return {
    debug: (message, context) => emitir('debug', message, context),
    info: (message, context) => emitir('info', message, context),
    warn: (message, context) => emitir('warn', message, context),
    error: (message, context) => emitir('error', message, context),
    child: (novos) => criarLogger({ ...bindings, ...novos }),
  };
}

export const logger = criarLogger();
