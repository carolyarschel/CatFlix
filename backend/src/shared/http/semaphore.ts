/**
 * Limitador de concorrência (§5.1: no máximo 4 requisições simultâneas ao
 * ingresso). Escrito à mão em vez de usar `p-limit` porque as versões atuais
 * dessa lib são ESM-only e o backend é CommonJS.
 */
export class Semaphore {
  private emUso = 0;
  private readonly fila: Array<() => void> = [];

  constructor(private readonly limite: number) {
    if (limite < 1) throw new Error('O limite de concorrência precisa ser ao menos 1.');
  }

  get inFlight(): number {
    return this.emUso;
  }

  get queued(): number {
    return this.fila.length;
  }

  async run<T>(tarefa: () => Promise<T>): Promise<T> {
    await this.adquirir();
    try {
      return await tarefa();
    } finally {
      this.liberar();
    }
  }

  private adquirir(): Promise<void> {
    if (this.emUso < this.limite) {
      this.emUso += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.fila.push(() => {
        this.emUso += 1;
        resolve();
      });
    });
  }

  private liberar(): void {
    this.emUso -= 1;
    const proxima = this.fila.shift();
    if (proxima) proxima();
  }
}
