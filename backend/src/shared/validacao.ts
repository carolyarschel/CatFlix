import type { z } from 'zod';
import { ValidationError } from './errors';

/**
 * Corpo (ou query) validado com `zod`, ou um 400 que diz o campo e o problema.
 * É a fronteira de entrada das rotas que escrevem no acervo.
 */
export function lerCorpo<T extends z.ZodTypeAny>(esquema: T, corpo: unknown): z.infer<T> {
  const validado = esquema.safeParse(corpo ?? {});
  if (!validado.success) {
    throw new ValidationError('Dados inválidos.', {
      details: validado.error.issues.map((i) => ({
        campo: i.path.join('.') || '(corpo)',
        problema: i.message,
      })),
    });
  }
  return validado.data;
}

/** Valor de query string como texto, ou `undefined` quando vazio. */
export function textoDaQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}
