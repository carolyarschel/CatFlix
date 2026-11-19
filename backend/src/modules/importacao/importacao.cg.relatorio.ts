import type { Casamento } from './importacao.cg.casamento';
import type { FilmeDoCg } from './importacao.cg.leitura';

/**
 * O relatório da importação do CG (cineon-expansao §11), como DADO: a tela
 * "Importar do Crônicas de Gatur" o desenha, e o comando de terminal o
 * escreve em Markdown. As duas saídas contam a mesma coisa.
 */

export interface LinhaDaImportacao {
  filme: FilmeDoCg;
  casamento: Casamento;
  resultado?: 'importado' | 'ja_importado';
}

export interface RelatorioDaImportacao {
  totais: {
    filmes: number;
    certos: number;
    duvidas: number;
    semCandidato: number;
    visualizacoes: number;
    lista: number;
    notas: number;
    comentarios: number;
    favoritos: number;
    /** só depois de aplicar */
    jaImportados: number;
  };
  /** o que vai para a fila Revisar, e por quê */
  revisao: Array<{
    titulo: string;
    lancamento: string | null;
    diretor: string | null;
    candidato: { titulo: string; ano: number | null; tmdbId: number } | null;
    motivo: string;
  }>;
  /** itens do CG que caíram no mesmo filme do TMDB */
  repetidos: Array<{ titulo: string; tmdbId: number; itens: string[] }>;
  avisos: Array<{ titulo: string; avisos: string[] }>;
  certos: Array<{ titulo: string; tmdbId: number; como: string; resumo: string }>;
}

export function resumoDoFilme(f: FilmeDoCg): string {
  return [
    f.visualizacoes.length ? `${f.visualizacoes.length} visualização` : null,
    f.lista.length ? `lista: ${f.lista.map((l) => l.pessoa).join('+')}` : null,
    f.notas.length ? `notas: ${f.notas.map((n) => `${n.pessoa} ${n.nota}`).join(', ')}` : null,
    f.favoritos.length ? `favorito: ${f.favoritos.join('+')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function montarRelatorio(linhas: LinhaDaImportacao[]): RelatorioDaImportacao {
  const soma = (f: (x: FilmeDoCg) => number) => linhas.reduce((n, l) => n + f(l.filme), 0);
  const conta = (t: Casamento['tipo']) => linhas.filter((l) => l.casamento.tipo === t).length;

  const porTmdb = new Map<number, LinhaDaImportacao[]>();
  for (const l of linhas) {
    if (l.casamento.tipo !== 'certo') continue;
    porTmdb.set(l.casamento.tmdbId, [...(porTmdb.get(l.casamento.tmdbId) ?? []), l]);
  }

  return {
    totais: {
      filmes: linhas.length,
      certos: conta('certo'),
      duvidas: conta('duvida'),
      semCandidato: conta('sem_candidato'),
      visualizacoes: soma((f) => f.visualizacoes.length),
      lista: soma((f) => f.lista.length),
      notas: soma((f) => f.notas.length),
      comentarios: soma((f) => Object.keys(f.comentarios).length),
      favoritos: soma((f) => f.favoritos.length),
      jaImportados: linhas.filter((l) => l.resultado === 'ja_importado').length,
    },
    revisao: linhas.flatMap((l) => {
      const c = l.casamento;
      if (c.tipo === 'certo') return [];
      return [
        {
          titulo: l.filme.titulo,
          lancamento: l.filme.lancamento,
          diretor: l.filme.diretor,
          candidato:
            c.tipo === 'duvida' ? { titulo: c.candidato.titulo, ano: c.candidato.ano, tmdbId: c.candidato.tmdbId } : null,
          motivo: c.motivo,
        },
      ];
    }),
    repetidos: [...porTmdb.entries()]
      .filter(([, grupo]) => grupo.length > 1)
      .map(([tmdbId, grupo]) => ({
        titulo: grupo[0]!.filme.titulo,
        tmdbId,
        itens: grupo.map((l) => resumoDoFilme(l.filme) || 'nada além do item'),
      })),
    avisos: linhas.filter((l) => l.filme.avisos.length > 0).map((l) => ({ titulo: l.filme.titulo, avisos: l.filme.avisos })),
    certos: linhas.flatMap((l) =>
      l.casamento.tipo === 'certo'
        ? [{ titulo: l.filme.titulo, tmdbId: l.casamento.tmdbId, como: l.casamento.como, resumo: resumoDoFilme(l.filme) }]
        : [],
    ),
  };
}

export function relatorioEmMarkdown(r: RelatorioDaImportacao, cabecalho: { aplicado: boolean; origem: string }): string {
  const t = r.totais;
  return [
    `# Importação do Crônicas de Gatur — ${cabecalho.aplicado ? 'APLICADA' : 'simulação'}`,
    '',
    `Gerado em ${new Date().toISOString()} a partir de \`${cabecalho.origem}\`.`,
    '',
    '| | |',
    '|---|---|',
    `| Filmes com algo a importar | ${t.filmes} |`,
    `| Casamento certo com o TMDB | ${t.certos} |`,
    `| Vão para a fila Revisar (dúvida) | ${t.duvidas} |`,
    `| Vão para a fila Revisar (sem candidato no TMDB) | ${t.semCandidato} |`,
    `| Visualizações | ${t.visualizacoes} |`,
    `| Entradas na lista "quero assistir" | ${t.lista} |`,
    `| Notas | ${t.notas} |`,
    `| Comentários | ${t.comentarios} |`,
    `| Tags "Favorito" | ${t.favoritos} |`,
    ...(cabecalho.aplicado ? [`| Já importados antes (pulados) | ${t.jaImportados} |`] : []),
    '',
    '## Vão para a fila Revisar',
    '',
    '| Filme no CG | Lançamento | Diretor (CG) | Candidato do TMDB | Motivo |',
    '|---|---|---|---|---|',
    ...r.revisao.map(
      (x) =>
        `| ${x.titulo} | ${x.lancamento ?? '—'} | ${x.diretor ?? '—'} | ${
          x.candidato ? `${x.candidato.titulo} (${x.candidato.ano ?? '?'}) — TMDB ${x.candidato.tmdbId}` : '—'
        } | ${x.motivo} |`,
    ),
    '',
    '## Itens repetidos no CG (o mesmo filme do TMDB)',
    '',
    'Entram no mesmo filme do Cineon. Quem assistiu por um item não fica na lista "quero assistir" pelo outro.',
    '',
    ...r.repetidos.map((x) => `- **${x.titulo}** (TMDB ${x.tmdbId}): ${x.itens.join(' | ')}`),
    '',
    '## Avisos (o que não pôde ser importado, ou foi por decisão)',
    '',
    ...r.avisos.map((x) => `- **${x.titulo}**: ${x.avisos.join('; ')}`),
    '',
    '## Casamentos certos',
    '',
    '| Filme no CG | TMDB | Como | O que entra |',
    '|---|---|---|---|',
    ...r.certos.map((x) => `| ${x.titulo} | ${x.tmdbId} | ${x.como} | ${x.resumo} |`),
    '',
  ].join('\n');
}
