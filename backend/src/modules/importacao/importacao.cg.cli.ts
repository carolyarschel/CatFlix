import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prisma } from '../../shared/prisma';
import { TmdbClient } from '../tmdb';
import { casarComTmdb } from './importacao.cg.casamento';
import { importarFilme } from './importacao.cg.aplicar';
import { lerFilmesDoCg } from './importacao.cg.leitura';
import { montarRelatorio, relatorioEmMarkdown, type LinhaDaImportacao } from './importacao.cg.relatorio';

/**
 * `npm run importar:cg -- --dump ../dumpCG.sql [--aplicar] [--relatorio caminho.md]`
 *
 * O mesmo que a tela Mais → "Importar do Crônicas de Gatur", pelo terminal —
 * útil no desenvolvimento. Sem `--aplicar` é SIMULAÇÃO: lê o dump, busca cada
 * filme no TMDB e escreve o relatório do que entraria, sem tocar no acervo.
 * Com `--aplicar`, grava; rodar de novo pula o que já foi importado.
 *
 * O relatório tem a lista de filmes do casal: o padrão é `backend/relatorios/`,
 * que está fora do git.
 */

function argumento(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function executarImportacaoCg(args: string[]): Promise<void> {
  const caminhoDoDump = argumento(args, '--dump');
  if (!caminhoDoDump) {
    console.error('Uso: npm run importar:cg -- --dump <arquivo.sql> [--aplicar] [--relatorio <arquivo.md>]');
    process.exitCode = 1;
    return;
  }
  const aplicar = args.includes('--aplicar');
  const caminhoDoRelatorio = resolve(
    argumento(args, '--relatorio') ??
      `relatorios/importacao-cg-${aplicar ? 'aplicada' : 'simulacao'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`,
  );

  const filmes = lerFilmesDoCg(readFileSync(resolve(caminhoDoDump), 'utf8'));
  console.log(`${filmes.length} filmes com algo a importar. ${aplicar ? 'APLICANDO.' : 'Simulação: nada será gravado no acervo.'}`);

  const tmdb = new TmdbClient();
  const linhas: LinhaDaImportacao[] = [];

  try {
    for (const [i, filme] of filmes.entries()) {
      const linha: LinhaDaImportacao = { filme, casamento: await casarComTmdb(filme, tmdb) };
      if (aplicar) linha.resultado = (await importarFilme(filme, linha.casamento, tmdb)).tipo;
      linhas.push(linha);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${filmes.length}`);
    }
  } finally {
    mkdirSync(dirname(caminhoDoRelatorio), { recursive: true });
    writeFileSync(
      caminhoDoRelatorio,
      relatorioEmMarkdown(montarRelatorio(linhas), { aplicado: aplicar, origem: caminhoDoDump }),
      'utf8',
    );
    await prisma.$disconnect();
  }

  const t = montarRelatorio(linhas).totais;
  console.log(
    `Certos: ${t.certos} · dúvida: ${t.duvidas} · sem candidato: ${t.semCandidato}` +
      (aplicar ? ` · já importados antes: ${t.jaImportados}` : ''),
  );
  console.log(`Relatório: ${caminhoDoRelatorio}`);
}
