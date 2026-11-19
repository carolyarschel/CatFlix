import type { Pessoa, WatchLocation } from '@prisma/client';

/**
 * Leitura do dump do Crônicas de Gatur antigo (cineon-expansao §11) — o
 * formato SQL texto do `pg_dump`, com as tabelas em blocos `COPY … FROM stdin`.
 *
 * Só lê; não fala com banco nem com TMDB. Devolve os filmes já com as regras
 * de importação aplicadas (ESTADO_ATUAL.md, seções 8.6 e 8.7), para o resto do
 * processo trabalhar com uma lista limpa e testável.
 */

const BARRA = String.fromCharCode(92);
const NULO = `${BARRA}N`;

/** Um filme do CG, pronto para virar dados do Cineon. */
export interface FilmeDoCg {
  /** chave no CG: `collection:<id>`, ou `activity:<id>` quando a atividade não tem item no catálogo */
  chave: string;
  titulo: string;
  /** `AAAA-MM-DD`, como o CG guarda (já é a estreia daqui na maioria dos casos) */
  lancamento: string | null;
  diretor: string | null;
  duracaoMinutos: number | null;
  tmdbId: number | null;
  visualizacoes: Array<{ data: string; local: WatchLocation; participantes: Pessoa[] }>;
  lista: Array<{ pessoa: Pessoa; interesse: number | null }>;
  notas: Array<{ pessoa: Pessoa; nota: number }>;
  comentarios: Partial<Record<Pessoa, string>>;
  favoritos: Pessoa[];
  /** o que não dá para importar, e por quê — vai para o relatório */
  avisos: string[];
}

interface Tabela {
  linhas: string[][];
  col: (linha: string[], coluna: string) => string | null;
}

/** Desfaz o escape do `COPY`: `\N` é nulo, `\n` `\t` `\\` são os caracteres. */
function valor(bruto: string | undefined): string | null {
  if (bruto === undefined || bruto === NULO) return null;
  let saida = '';
  for (let i = 0; i < bruto.length; i += 1) {
    const c = bruto[i]!;
    if (c !== BARRA || i === bruto.length - 1) {
      saida += c;
      continue;
    }
    const prox = bruto[++i]!;
    saida += prox === 'n' ? '\n' : prox === 't' ? '\t' : prox === 'r' ? '\r' : prox;
  }
  return saida;
}

export function lerTabela(dump: string, nome: string): Tabela {
  const inicio = dump.indexOf(`COPY public.${nome} (`);
  if (inicio < 0) throw new Error(`O dump não tem a tabela "${nome}".`);

  const fimDoCabecalho = dump.indexOf('\n', inicio);
  const cabecalho = dump.slice(inicio, fimDoCabecalho);
  const colunas = cabecalho
    .slice(cabecalho.indexOf('(') + 1, cabecalho.lastIndexOf(')'))
    .split(', ')
    .map((c) => c.replace(/"/g, ''));

  // o bloco termina numa linha só com `\.`
  const fim = dump.indexOf(`\n${BARRA}.\n`, fimDoCabecalho);
  const corpo = fim < 0 ? '' : dump.slice(fimDoCabecalho + 1, fim + 1);
  const linhas = corpo
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/\r$/, '').split('\t'));

  for (const l of linhas) {
    if (l.length !== colunas.length) {
      throw new Error(`Linha de "${nome}" com ${l.length} campos; o cabeçalho tem ${colunas.length}.`);
    }
  }

  const indice = new Map(colunas.map((c, i) => [c, i]));
  return {
    linhas,
    col: (linha, coluna) => {
      const i = indice.get(coluna);
      if (i === undefined) throw new Error(`A tabela "${nome}" não tem a coluna "${coluna}".`);
      return valor(linha[i]);
    },
  };
}

function participantes(whoDid: string | null): Pessoa[] {
  if (whoDid === 'cat') return ['CAT'];
  if (whoDid === 'bear') return ['BEAR'];
  return ['CAT', 'BEAR']; // 'both' é o padrão do CG
}

function inteiro(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SIM = (v: string | null) => v === 't' || v === 'true';

/**
 * Decisões da Carol de 19/11/2026 (ESTADO_ATUAL.md §8.7) para os filmes
 * "concluídos" no catálogo que não têm visualização na timeline: estes dois
 * ficam como NÃO assistidos; os outros, assistidos no cinema na data de
 * lançamento que o CG guarda.
 */
export const CONCLUIDOS_NAO_ASSISTIDOS = new Set(['A Mulher de Preto', 'A Origem dos Guardiões']);

export function lerFilmesDoCg(dump: string): FilmeDoCg[] {
  const atividades = lerTabela(dump, 'activities');
  const catalogo = lerTabela(dump, 'collections');

  const filmesDaTimeline = atividades.linhas.filter((l) => atividades.col(l, 'type') === 'filme');
  const itensDeFilme = catalogo.linhas.filter((l) => catalogo.col(l, 'collection_type') === 'filme');
  const idsDoCatalogo = new Set(itensDeFilme.map((l) => catalogo.col(l, 'id')));

  const visualizacoesPorItem = new Map<string, FilmeDoCg['visualizacoes']>();
  const soltas: string[][] = [];

  for (const a of filmesDaTimeline) {
    const item = atividades.col(a, 'collection_id');
    const visualizacao = {
      data: atividades.col(a, 'activity_date')!,
      // sem local, o formulário do CG mostrava "Em casa"
      local: (atividades.col(a, 'location') === 'cinema' ? 'CINEMA' : 'CASA') as WatchLocation,
      participantes: participantes(atividades.col(a, 'who_did')),
    };
    if (item && idsDoCatalogo.has(item)) {
      visualizacoesPorItem.set(item, [...(visualizacoesPorItem.get(item) ?? []), visualizacao]);
    } else {
      soltas.push(a);
    }
  }

  const filmes: FilmeDoCg[] = itensDeFilme.map((c) => {
    const id = catalogo.col(c, 'id')!;
    const titulo = catalogo.col(c, 'title')!.trim();
    const lancamento = catalogo.col(c, 'release_date');
    const whoDid = catalogo.col(c, 'who_did');
    const status = catalogo.col(c, 'status');
    const avisos: string[] = [];

    let visualizacoes = visualizacoesPorItem.get(id) ?? [];
    const concluido = [status, catalogo.col(c, 'status_cat'), catalogo.col(c, 'status_bear')].includes('concluido');

    if (visualizacoes.length === 0 && concluido) {
      if (CONCLUIDOS_NAO_ASSISTIDOS.has(titulo)) {
        avisos.push('concluído no CG, mas marcado como não assistido (decisão de 19/11/2026)');
      } else if (lancamento) {
        visualizacoes = [{ data: lancamento, local: 'CINEMA', participantes: participantes(whoDid) }];
        avisos.push('sem visualização na timeline: assistido no cinema na data de lançamento (decisão de 19/11/2026)');
      } else {
        avisos.push('concluído sem visualização e sem data de lançamento: não importado como assistido');
      }
    }

    const viu = new Set(visualizacoes.flatMap((v) => v.participantes));

    const lista: FilmeDoCg['lista'] = [];
    for (const [pessoa, sufixo] of [
      ['CAT', 'cat'],
      ['BEAR', 'bear'],
    ] as const) {
      const proprio = catalogo.col(c, `status_${sufixo}`);
      // o status de cada um manda; sem ele, o geral vale para quem o `who_did` inclui
      const quer =
        proprio === 'quero_assistir' ||
        (proprio === null && status === 'quero_assistir' && participantes(whoDid).includes(pessoa));
      if (quer && !viu.has(pessoa)) {
        const interesse = inteiro(catalogo.col(c, `interest_${sufixo}`));
        lista.push({ pessoa, interesse: interesse !== null && interesse >= 1 && interesse <= 5 ? interesse : null });
      }
    }

    const notas: FilmeDoCg['notas'] = [];
    for (const [pessoa, sufixo] of [
      ['CAT', 'cat'],
      ['BEAR', 'bear'],
    ] as const) {
      const nota = inteiro(catalogo.col(c, `rating_${sufixo}`));
      if (nota === null) continue;
      if (!viu.has(pessoa)) {
        avisos.push(`nota ${nota} de ${pessoa} não importada: só dá nota quem assistiu`);
        continue;
      }
      notas.push({ pessoa, nota });
    }

    const comentarios: FilmeDoCg['comentarios'] = {};
    for (const [pessoa, sufixo] of [
      ['CAT', 'cat'],
      ['BEAR', 'bear'],
    ] as const) {
      const texto = catalogo.col(c, `notes_${sufixo}`)?.trim();
      if (texto) comentarios[pessoa] = texto;
    }
    if (Object.keys(comentarios).length > 0 && visualizacoes.length === 0) {
      avisos.push('comentário sem visualização: não importado (a observação mora na visualização)');
    }

    return {
      chave: `collection:${id}`,
      titulo,
      lancamento,
      diretor: catalogo.col(c, 'director')?.trim() || null,
      duracaoMinutos: inteiro(catalogo.col(c, 'duration_minutes')),
      tmdbId: inteiro(catalogo.col(c, 'tmdb_id')),
      visualizacoes,
      lista,
      notas,
      comentarios,
      favoritos: (['CAT', 'BEAR'] as const).filter((p) =>
        SIM(catalogo.col(c, p === 'CAT' ? 'favorite_cat' : 'favorite_bear')),
      ),
      avisos,
    };
  });

  // visualização cujo item do catálogo não existe mais: entra com o que a
  // própria atividade tem (título, data, duração)
  for (const a of soltas) {
    filmes.push({
      chave: `activity:${atividades.col(a, 'id')}`,
      titulo: atividades.col(a, 'title')!.trim(),
      lancamento: null,
      diretor: null,
      duracaoMinutos: inteiro(atividades.col(a, 'duration_minutes')),
      tmdbId: null,
      visualizacoes: [
        {
          data: atividades.col(a, 'activity_date')!,
          local: atividades.col(a, 'location') === 'cinema' ? 'CINEMA' : 'CASA',
          participantes: participantes(atividades.col(a, 'who_did')),
        },
      ],
      lista: [],
      notas: [],
      comentarios: {},
      favoritos: [],
      avisos: ['visualização cujo item do catálogo do CG não existe mais'],
    });
  }

  // só interessa o que tem algo a importar
  return filmes.filter(
    (f) => f.visualizacoes.length > 0 || f.lista.length > 0 || f.favoritos.length > 0 || f.notas.length > 0,
  );
}
