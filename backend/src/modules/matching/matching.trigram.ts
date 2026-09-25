/**
 * Similaridade por trigrama, compatível com o `pg_trgm` do Postgres.
 *
 * Por que reimplementar em vez de só chamar o banco: o `pg_trgm` é usado em
 * dois papéis diferentes. Para **achar** candidatos no catálogo, o índice GIN
 * do Postgres é insubstituível. Para **pontuar** cada candidato do TMDB, uma
 * ida ao banco por par seria desperdício, e o scoring fica impuro e lento de
 * testar.
 *
 * Então: recuperação no Postgres (indexada), pontuação aqui (pura). Os dois
 * PRECISAM concordar, e há um teste de integração que compara esta função com
 * a `similarity()` do banco par a par. Se divergirem, o teste quebra.
 *
 * O algoritmo do pg_trgm:
 *   1. minúsculas
 *   2. tudo que não é alfanumérico vira separador de palavra
 *   3. cada palavra vira "  palavra " (dois espaços antes, um depois)
 *   4. trigramas = todas as substrings de 3 caracteres, como CONJUNTO
 *   5. similaridade = |interseção| / |união|
 */

/** Passo 2 e 3: quebra em palavras e acrescenta o preenchimento do pg_trgm. */
function palavrasComPreenchimento(valor: string): string[] {
  return valor
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((palavra) => `  ${palavra} `);
}

/** Conjunto de trigramas de um texto, do jeito que o Postgres monta. */
export function trigramas(valor: string): Set<string> {
  const conjunto = new Set<string>();

  for (const palavra of palavrasComPreenchimento(valor)) {
    for (let i = 0; i + 3 <= palavra.length; i += 1) {
      conjunto.add(palavra.slice(i, i + 3));
    }
  }

  return conjunto;
}

/**
 * Similaridade entre 0 e 1, igual à `similarity()` do Postgres.
 * Duas strings sem nenhum caractere alfanumérico dão 0, não NaN.
 */
export function similaridade(a: string, b: string): number {
  const ta = trigramas(a);
  const tb = trigramas(b);

  if (ta.size === 0 || tb.size === 0) return 0;

  let interseccao = 0;
  for (const t of ta) if (tb.has(t)) interseccao += 1;

  const uniao = ta.size + tb.size - interseccao;
  return uniao === 0 ? 0 : interseccao / uniao;
}
