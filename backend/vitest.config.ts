import { defineConfig } from 'vitest/config';

/**
 * ⚠️ `fileParallelism: false` não é preferência de estilo, é correção de bug.
 *
 * Os testes de integração compartilham UM banco de desenvolvimento e limpam o
 * que criaram por prefixo. Rodando em paralelo, o `afterEach` de um arquivo
 * apagava os dados de outro no meio da execução: o `catalog` limpa
 * `ingressoEventId` começando com `__teste__`, e o `review` usa `__teste__rev`,
 * que casa com esse prefixo.
 *
 * O sintoma era pior que a causa — os testes passavam sozinhos e falhavam na
 * suíte, o que faz suspeitar do código em vez do arranjo. Serializar por
 * arquivo elimina a classe inteira de problema e custa pouco: a suíte leva
 * poucos segundos.
 *
 * Se um dia o tempo incomodar, a saída é um banco por worker (`DATABASE_URL`
 * com sufixo do `VITEST_WORKER_ID`), não voltar o paralelismo.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    // um teste de integração travado não pode pendurar a suíte inteira
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
