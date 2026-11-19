import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { TmdbClient } from '../tmdb';
import { casarComTmdb } from './importacao.cg.casamento';
import { importarFilme } from './importacao.cg.aplicar';
import { lerFilmesDoCg } from './importacao.cg.leitura';
import { montarRelatorio, type LinhaDaImportacao, type RelatorioDaImportacao } from './importacao.cg.relatorio';

const log = logger.child({ module: 'importacao' });

/**
 * A importação do CG pela tela do app (cineon-expansao §11), sem SSH: o dump
 * chega por upload, a simulação roda em segundo plano, a tela acompanha, e
 * "Aplicar" grava com os casamentos que a simulação já calculou.
 *
 * **Uma tarefa de cada vez, na memória do processo.** É uma operação de uso
 * raro (uma vez, talvez duas), e guardá-la em tabela seria guardar a lista de
 * filmes do dump no banco sem necessidade. Se o servidor reiniciar no meio,
 * a tarefa some: envia-se o arquivo de novo — a gravação é idempotente.
 *
 * O texto do dump não é guardado: só os filmes já lidos dele.
 */

export type FaseDaImportacao = 'casando' | 'pronto' | 'aplicando' | 'aplicado' | 'erro';

export interface EstadoDaImportacao {
  id: string;
  fase: FaseDaImportacao;
  /** filmes já processados na fase atual */
  feitos: number;
  total: number;
  criadaEm: Date;
  /** quem enviou */
  por: string;
  /** a partir de "pronto" */
  relatorio: RelatorioDaImportacao | null;
  erro: string | null;
}

interface Tarefa extends Omit<EstadoDaImportacao, 'relatorio'> {
  linhas: LinhaDaImportacao[];
  rodando: Promise<void>;
}

let atual: Tarefa | null = null;

function publico(t: Tarefa): EstadoDaImportacao {
  const { linhas, rodando: _rodando, ...resto } = t;
  return {
    ...resto,
    relatorio: t.fase === 'pronto' || t.fase === 'aplicado' ? montarRelatorio(linhas) : null,
  };
}

function ocupada(t: Tarefa | null): boolean {
  return t !== null && (t.fase === 'casando' || t.fase === 'aplicando');
}

/** Lê o dump e começa a simulação. Devolve na hora; o resto é em segundo plano. */
export function iniciarSimulacao(
  dump: string,
  por: string,
  tmdb: TmdbClient = new TmdbClient(),
): EstadoDaImportacao {
  if (ocupada(atual)) {
    throw new ConflictError('Já há uma importação em andamento. Espere ela terminar.');
  }

  let filmes;
  try {
    filmes = lerFilmesDoCg(dump);
  } catch (erro) {
    throw new ValidationError(
      `Não consegui ler o arquivo como dump do Crônicas de Gatur: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
  if (filmes.length === 0) {
    throw new ValidationError('O dump não tem nenhum filme para importar.');
  }

  const tarefa: Tarefa = {
    id: randomUUID(),
    fase: 'casando',
    feitos: 0,
    total: filmes.length,
    criadaEm: new Date(),
    por,
    erro: null,
    linhas: [],
    rodando: Promise.resolve(),
  };

  tarefa.rodando = (async () => {
    try {
      for (const filme of filmes) {
        tarefa.linhas.push({ filme, casamento: await casarComTmdb(filme, tmdb) });
        tarefa.feitos += 1;
      }
      tarefa.fase = 'pronto';
      log.info('simulação da importação do CG pronta', { id: tarefa.id, filmes: tarefa.total });
    } catch (erro) {
      tarefa.fase = 'erro';
      tarefa.erro = erro instanceof Error ? erro.message : String(erro);
      log.error('simulação da importação do CG falhou', { id: tarefa.id, erro });
    }
  })();

  atual = tarefa;
  return publico(tarefa);
}

function aTarefa(id: string): Tarefa {
  if (!atual || atual.id !== id) {
    throw new NotFoundError('Esta importação não existe mais (o servidor pode ter reiniciado). Envie o arquivo de novo.');
  }
  return atual;
}

export function estadoDaImportacao(id: string): EstadoDaImportacao {
  return publico(aTarefa(id));
}

/** Grava, filme a filme, com os casamentos da simulação. */
export function aplicarImportacao(id: string, tmdb: TmdbClient = new TmdbClient()): EstadoDaImportacao {
  const tarefa = aTarefa(id);
  // falhou no meio da gravação: tentar de novo pula os já importados
  const podeRetomar = tarefa.fase === 'erro' && tarefa.linhas.length === tarefa.total;
  if (tarefa.fase !== 'pronto' && !podeRetomar) {
    throw new ConflictError(
      tarefa.fase === 'aplicado' ? 'Esta importação já foi aplicada.' : 'A simulação ainda não terminou.',
    );
  }

  tarefa.fase = 'aplicando';
  tarefa.feitos = 0;
  tarefa.rodando = (async () => {
    try {
      for (const linha of tarefa.linhas) {
        linha.resultado = (await importarFilme(linha.filme, linha.casamento, tmdb)).tipo;
        tarefa.feitos += 1;
      }
      tarefa.fase = 'aplicado';
      log.info('importação do CG aplicada', { id: tarefa.id, filmes: tarefa.total });
    } catch (erro) {
      // o que já foi gravado fica (cada filme é uma transação); aplicar de
      // novo pula os já importados
      tarefa.fase = 'erro';
      tarefa.erro = erro instanceof Error ? erro.message : String(erro);
      log.error('importação do CG falhou no meio', { id: tarefa.id, feitos: tarefa.feitos, erro });
    }
  })();

  return publico(tarefa);
}

/** Só para os testes: espera a fase atual terminar. */
export async function aguardarImportacao(id: string): Promise<EstadoDaImportacao> {
  await aTarefa(id).rodando;
  return estadoDaImportacao(id);
}

/** Só para os testes. */
export function esquecerImportacao(): void {
  atual = null;
}
