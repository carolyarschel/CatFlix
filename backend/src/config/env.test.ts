import { describe, expect, it } from 'vitest';

/**
 * Trava a regressão que custou caro: um acento no User-Agent fazia o WAF do
 * OMDb devolver 403 em 100% das chamadas (medido, 5/5), e o erro parecia vir
 * da API. Cabeçalho HTTP é ASCII (RFC 9110 §5.5).
 */
describe('INGRESSO_USER_AGENT', () => {
  const ehAsciiImprimivel = (v: string) => /^[\x20-\x7e]*$/.test(v);

  it('o padrão do projeto é ASCII', async () => {
    const { env } = await import('./env');
    expect(ehAsciiImprimivel(env.INGRESSO_USER_AGENT)).toBe(true);
  });

  it('a regra rejeita acento', () => {
    expect(ehAsciiImprimivel('AppFilmes/0.1 (responsável)')).toBe(false);
    expect(ehAsciiImprimivel('AppFilmes/0.1 (instância)')).toBe(false);
    expect(ehAsciiImprimivel('AppFilmes/0.1 (uso pessoal)')).toBe(true);
  });
});
