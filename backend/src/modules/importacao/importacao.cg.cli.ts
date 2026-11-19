import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prisma } from '../../shared/prisma';
import { TmdbClient } from '../tmdb';
import { casarComTmdb, type Casamento } from './importacao.cg.casamento';
import { importarFilme } from './importacao.cg.aplicar';
import { lerFilmesDoCg, type FilmeDoCg } from './importacao.cg.leitura';

/**
 * `npm run importar:cg -- --dump ../dumpCG.sql [--aplicar] [--relatorio caminho.md]`
 *
 * Sem `--aplicar` é SIMULAÇÃO: lê o dump, busca cada filme no TMDB e escreve o
 * relatório do que entraria — sem tocar no acervo. (As buscas ficam
 * registradas como `RawPayload`, como toda chamada ao TMDB.) Com `--aplicar`,
 * grava; rodar de novo pula o que já foi importado.
 *
 * O relatório lista título por título o que casou, o que vai para a fila
 * Revisar e por quê, e o que não pôde ser importado. Ele tem a lista de filmes
 * do casal: o padrão é `backend/relatorios/`, que está fora do git.
 */

interface Linha {
  filme: FilmeDoCg;
  casamento: Casamento;
  resultado?: string;
}

function argumento(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

function resumoDoFilme(f: FilmeDoCg): string {
  const partes = [
    f.visualizacoes.length ? `${f.visualizacoes.length} visualização` : null,
    f.lista.length ? `lista: ${f.lista.map((l) => l.pessoa).join('+')}` : null,
    f.notas.length ? `notas: ${f.notas.map((n) => `${n.pessoa} ${n.nota}`).join(', ')}` : null,
    f.favoritos.length ? `favorito: ${f.favoritos.join('+')}` : null,
  ].filter(Boolean);
  return partes.join(' · ');
}

/** Grupos de itens do CG que casaram com o mesmo filme do TMDB. */
function repetidos(certos: Linha[]): Linha[][] {
  const porTmdb = new Map<number, Linha[]>();
  for (const l of certos) {
    if (l.casamento.tipo !== 'certo') continue;
    porTmdb.set(l.casamento.tmdbId, [...(porTmdb.get(l.casamento.tmdbId) ?? []), l]);
  }
  return [...porTmdb.values()].filter((g) => g.length > 1);
}

function relatorio(linhas: Linha[], aplicado: boolean, dump: string): string {
  const certos = linhas.filter((l) => l.casamento.tipo === 'certo');
  const duvidas = linhas.filter((l) => l.casamento.tipo === 'duvida');
  const semCandidato = linhas.filter((l) => l.casamento.tipo === 'sem_candidato');
  const avisos = linhas.filter((l) => l.filme.avisos.length > 0);
  const soma = (f: (x: FilmeDoCg) => number) => linhas.reduce((n, l) => n + f(l.filme), 0);

  const out: string[] = [
    `# Importação do Crônicas de Gatur — ${aplicado ? 'APLICADA' : 'simulação'}`,
    '',
    `Gerado em ${new Date().toISOString()} a partir de \`${dump}\`.`,
    '',
    '| | |',
    '|---|---|',
    `| Filmes com algo a importar | ${linhas.length} |`,
    `| Casamento certo com o TMDB | ${certos.length} |`,
    `| Vão para a fila Revisar (dúvida) | ${duvidas.length} |`,
    `| Vão para a fila Revisar (sem candidato no TMDB) | ${semCandidato.length} |`,
    `| Visualizações | ${soma((f) => f.visualizacoes.length)} |`,
    `| Entradas na lista "quero assistir" | ${soma((f) => f.lista.length)} |`,
    `| Notas | ${soma((f) => f.notas.length)} |`,
    `| Tags "Favorito" | ${soma((f) => f.favoritos.length)} |`,
    '',
    '## Vão para a fila Revisar',
    '',
    '| Filme no CG | Lançamento | Diretor (CG) | Candidato do TMDB | Motivo |',
    '|---|---|---|---|---|',
    ...[...duvidas, ...semCandidato].map((l) => {
      const c = l.casamento;
      const candidato =
        c.tipo === 'duvida' ? `${c.candidato.titulo} (${c.candidato.ano ?? '?'}) — TMDB ${c.candidato.tmdbId}` : '—';
      const motivo = c.tipo === 'certo' ? '' : c.motivo;
      return `| ${l.filme.titulo} | ${l.filme.lancamento ?? '—'} | ${l.filme.diretor ?? '—'} | ${candidato} | ${motivo} |`;
    }),
    '',
    '## Itens repetidos no CG (o mesmo filme do TMDB)',
    '',
    'Entram no mesmo filme do Cineon. Visualizações dos dois itens somam (pode ser rever ou registro repetido); quem assistiu por um item não fica na lista "quero assistir" pelo outro.',
    '',
    ...repetidos(certos).map(
      (grupo) =>
        `- **${grupo[0]!.filme.titulo}** (TMDB ${(grupo[0]!.casamento as Extract<Casamento, { tipo: 'certo' }>).tmdbId}): ` +
        grupo.map((l) => resumoDoFilme(l.filme) || 'nada além do item').join(' | '),
    ),
    '',
    '## Avisos (o que não pôde ser importado, ou foi por decisão)',
    '',
    ...avisos.map((l) => `- **${l.filme.titulo}**: ${l.filme.avisos.join('; ')}`),
    '',
    '## Casamentos certos',
    '',
    '| Filme no CG | TMDB | Como | O que entra |',
    '|---|---|---|---|',
    ...certos.map((l) => {
      const c = l.casamento as Extract<Casamento, { tipo: 'certo' }>;
      return `| ${l.filme.titulo} | ${c.tmdbId} | ${c.como} | ${resumoDoFilme(l.filme)} |`;
    }),
    '',
  ];
  return out.join('\n');
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
  const linhas: Linha[] = [];

  try {
    for (const [i, filme] of filmes.entries()) {
      const casamento = await casarComTmdb(filme, tmdb);
      const linha: Linha = { filme, casamento };
      if (aplicar) {
        const r = await importarFilme(filme, casamento, tmdb);
        linha.resultado = r.tipo;
      }
      linhas.push(linha);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${filmes.length}`);
    }
  } finally {
    mkdirSync(dirname(caminhoDoRelatorio), { recursive: true });
    writeFileSync(caminhoDoRelatorio, relatorio(linhas, aplicar, caminhoDoDump), 'utf8');
    await prisma.$disconnect();
  }

  const conta = (t: Casamento['tipo']) => linhas.filter((l) => l.casamento.tipo === t).length;
  console.log(
    `Certos: ${conta('certo')} · dúvida: ${conta('duvida')} · sem candidato: ${conta('sem_candidato')}` +
      (aplicar ? ` · já importados antes: ${linhas.filter((l) => l.resultado === 'ja_importado').length}` : ''),
  );
  console.log(`Relatório: ${caminhoDoRelatorio}`);
}
