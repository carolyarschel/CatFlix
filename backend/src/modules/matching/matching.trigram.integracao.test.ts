import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { prisma } from '../../shared/prisma';
import { normalizarTitulo } from './matching.normalizer';
import { similaridade } from './matching.trigram';

/**
 * O `pg_trgm` é usado em dois papéis: o Postgres ACHA candidatos pelo índice
 * GIN, e o JavaScript PONTUA cada um. Se as duas implementações divergirem, o
 * matching recupera um candidato e pontua outro valor — um bug que não
 * apareceria em teste nenhum dos outros.
 *
 * Este teste existe só para travar essa divergência. Precisa do Postgres de
 * pé; sem banco, ele se anuncia como pulado em vez de dar falso verde.
 *
 * O `skipIf` do Vitest NÃO serve aqui: ele é avaliado na coleta, antes do
 * `beforeAll`, então a flag ainda é `false` e o teste era pulado SEMPRE —
 * inclusive com o banco no ar. A checagem precisa ser dentro do teste.
 */

let temBanco = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

const PARES: Array<[string, string]> = [
  ['duna parte 2', 'duna parte dois'],
  ['duna parte 2', 'duna parte 2'],
  ['divertidamente 2', 'divertida mente 2'],
  ['o brutalista', 'the brutalist'],
  ['met opera la boheme ao vivo', 'la boheme'],
  ['toy story 5', 'toy story'],
  ['a odisseia', 'the odyssey'],
  ['homem aranha um novo dia', 'homem aranha'],
  ['sobrenatural agora entre nos', 'sobrenatural'],
  ['rammstein live in mexico city', 'rammstein live in mexico city'],
  ['', 'duna'],
  ['acentuacao ja removida', 'acentuacao ja removida'],
];

describe('similaridade JS × pg_trgm', () => {
  it('concorda com o Postgres em todos os pares', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    for (const [a, b] of PARES) {
      const [linha] = await prisma.$queryRaw<Array<{ s: number }>>`
        SELECT similarity(${a}, ${b})::float8 AS s`;

      expect(similaridade(a, b), `divergiu em "${a}" × "${b}"`).toBeCloseTo(linha!.s, 6);
    }
  });

  it('concorda também nos títulos normalizados do §7.4', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    const casos = [
      ['DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX', 'Duna: Parte Dois'],
      ['DIVERTIDAMENTE 2 - SESSÃO KIDS', 'Divertida Mente 2'],
      ['O BRUTALISTA (LEG)', 'O Brutalista'],
      ['MET ÓPERA: LA BOHÈME AO VIVO', 'La Bohème'],
    ];

    for (const [bruto, outro] of casos) {
      const a = normalizarTitulo(bruto!).normalizado;
      const b = normalizarTitulo(outro!).normalizado;

      const [linha] = await prisma.$queryRaw<Array<{ s: number }>>`
        SELECT similarity(${a}, ${b})::float8 AS s`;

      expect(similaridade(a, b), `divergiu em "${a}" × "${b}"`).toBeCloseTo(linha!.s, 6);
    }
  });

  it('o limiar padrão do operador % é o que esperamos', async (ctx: TestContext) => {
    if (!temBanco) return ctx.skip();

    // `buscarTitulosParecidos` depende do operador %, que usa este limiar.
    // Se alguém mexer nele no banco, a recuperação muda sem aviso.
    const [linha] = await prisma.$queryRaw<Array<{ limiar: number }>>`
      SELECT show_limit()::float8 AS limiar`;

    expect(linha!.limiar).toBeCloseTo(0.3, 5);
  });
});
