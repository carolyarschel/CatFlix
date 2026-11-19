/** A nota do casal, de 0 a 10 em meio ponto, como se escreve em pt-BR: "8", "8,5". */
export function formatarNota(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}
