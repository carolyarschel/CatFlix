import { describe, expect, it } from 'vitest';
import { decidirCasamento, type CandidatoDaBusca } from './importacao.cg.casamento';
import { lerFilmesDoCg } from './importacao.cg.leitura';

/**
 * Leitura do dump do CG e decisão do casamento (cineon-expansao §11).
 *
 * O dump aqui é SINTÉTICO, escrito à mão no formato do `pg_dump` (blocos
 * `COPY … FROM stdin`, campos separados por tab, `\N` para nulo). Nada dos
 * dados reais do casal entra no repositório.
 */

const T = '\t';
const N = String.fromCharCode(92) + 'N';
const FIM = String.fromCharCode(92) + '.';

const COLUNAS_ATIVIDADE = ['id', 'type', 'title', 'activity_date', 'who_did', 'location', 'collection_id', 'duration_minutes'];
const COLUNAS_CATALOGO = [
  'id', 'collection_type', 'title', 'release_date', 'director', 'duration_minutes', 'tmdb_id', 'who_did', 'status',
  'status_cat', 'status_bear', 'interest_cat', 'interest_bear', 'rating_cat', 'rating_bear', 'notes_cat', 'notes_bear',
  'favorite_cat', 'favorite_bear',
];

function dump(atividades: string[][], catalogo: string[][]): string {
  const bloco = (nome: string, cols: string[], linhas: string[][]) =>
    [`COPY public.${nome} (${cols.join(', ')}) FROM stdin;`, ...linhas.map((l) => l.join(T)), FIM, ''].join('\n');
  return ['-- dump sintético', bloco('activities', COLUNAS_ATIVIDADE, atividades), bloco('collections', COLUNAS_CATALOGO, catalogo)].join('\n');
}

/** Um item de catálogo com valores padrão; `p` sobrescreve por nome de coluna. */
function item(p: Record<string, string>): string[] {
  const base: Record<string, string> = {
    collection_type: 'filme', release_date: N, director: N, duration_minutes: N, tmdb_id: N, who_did: 'both',
    status: N, status_cat: N, status_bear: N, interest_cat: N, interest_bear: N, rating_cat: N, rating_bear: N,
    notes_cat: N, notes_bear: N, favorite_cat: 'f', favorite_bear: 'f',
  };
  return COLUNAS_CATALOGO.map((c) => p[c] ?? base[c] ?? N);
}

const DUMP = dump(
  [
    ['1', 'filme', 'Visto Junto', '2024-03-10', 'both', 'cinema', '10', '120'],
    ['2', 'filme', 'Item Apagado', '2023-01-05', 'cat', N, '999', '95'],
    ['3', 'livro', 'Um Livro', '2024-01-01', 'both', N, N, N],
  ],
  [
    item({ id: '10', title: 'Visto Junto', release_date: '2024-02-01', director: 'Diretora X', status: 'concluido',
      rating_cat: '9', rating_bear: '7', notes_cat: 'amei' + String.fromCharCode(92) + 'nmuito', favorite_cat: 't' }),
    item({ id: '11', title: 'Concluído Sem Data', release_date: '2019-01-17', who_did: 'cat', status_cat: 'concluido', rating_cat: '10' }),
    item({ id: '12', title: 'A Mulher de Preto', status: 'quero_assistir', status_cat: 'concluido', rating_cat: '7' }),
    item({ id: '13', title: 'Quero Ver', status: 'quero_assistir', who_did: 'bear', interest_bear: '4' }),
    item({ id: '14', title: 'Só Ela Viu', status: 'concluido', rating_bear: '8' }),
    item({ id: '15', title: 'Nada A Importar', status: 'nao_iniciado' }),
  ],
);

// a timeline do item 14: só a CAT viu, mas o BEAR deu nota
const DUMP_COM_14 = DUMP.replace(
  `3${T}livro`,
  `4${T}filme${T}Só Ela Viu${T}2022-05-05${T}cat${T}casa${T}14${T}${N}\n3${T}livro`,
);

describe('lerFilmesDoCg', () => {
  const filmes = lerFilmesDoCg(DUMP_COM_14);
  const de = (titulo: string) => filmes.find((f) => f.titulo === titulo);

  it('visualização da timeline com nota, comentário (com o escape desfeito) e favorito', () => {
    expect(de('Visto Junto')).toMatchObject({
      chave: 'collection:10',
      visualizacoes: [{ data: '2024-03-10', local: 'CINEMA', participantes: ['CAT', 'BEAR'] }],
      notas: [{ pessoa: 'CAT', nota: 9 }, { pessoa: 'BEAR', nota: 7 }],
      comentarios: { CAT: 'amei\nmuito' },
      favoritos: ['CAT'],
      lista: [],
    });
  });

  it('concluído sem timeline: assistido no cinema na data de lançamento (decisão de 19/11/2026)', () => {
    expect(de('Concluído Sem Data')).toMatchObject({
      visualizacoes: [{ data: '2019-01-17', local: 'CINEMA', participantes: ['CAT'] }],
      notas: [{ pessoa: 'CAT', nota: 10 }],
    });
  });

  it('"A Mulher de Preto" fica não assistida; a nota dela não entra; a lista dele vem do status geral', () => {
    const f = de('A Mulher de Preto')!;
    expect(f.visualizacoes).toEqual([]);
    expect(f.notas).toEqual([]);
    expect(f.lista).toEqual([{ pessoa: 'BEAR', interesse: null }]);
    expect(f.avisos.join(' ')).toMatch(/não assistido/);
  });

  it('o status geral só vale para quem o who_did inclui', () => {
    expect(de('Quero Ver')!.lista).toEqual([{ pessoa: 'BEAR', interesse: 4 }]);
  });

  it('nota de quem não estava na visualização não entra, e vira aviso', () => {
    const f = de('Só Ela Viu')!;
    expect(f.notas).toEqual([]);
    expect(f.avisos.join(' ')).toMatch(/nota 8 de BEAR/);
  });

  it('atividade cujo item sumiu do catálogo entra sozinha; sem local vira casa', () => {
    expect(de('Item Apagado')).toMatchObject({
      chave: 'activity:2',
      visualizacoes: [{ data: '2023-01-05', local: 'CASA', participantes: ['CAT'] }],
    });
  });

  it('registro repetido: a visualização não entra, mas a nota de quem estava sim', () => {
    const comRepetido = dump(
      [['5', 'filme', 'Repetido', '2026-07-26', 'both', 'casa', '242', N]],
      [item({ id: '242', title: 'Repetido', status: 'concluido', rating_cat: '8' })],
    );
    const [f] = lerFilmesDoCg(comRepetido);
    expect(f).toMatchObject({ chave: 'collection:242', visualizacoes: [], notas: [{ pessoa: 'CAT', nota: 8 }] });
    expect(f!.avisos.join(' ')).toMatch(/repetida/);
  });

  it('livro e item sem nada a importar ficam de fora', () => {
    expect(de('Um Livro')).toBeUndefined();
    expect(de('Nada A Importar')).toBeUndefined();
  });
});

describe('decidirCasamento', () => {
  const filme = { titulo: 'Duna: Parte Dois', lancamento: '2024-02-29', diretor: 'Denis Villeneuve', tmdbId: null };
  const c = (tmdbId: number, titulo: string, ano: number, tituloOriginal: string | null = null): CandidatoDaBusca => ({
    tmdbId, titulo, ano, tituloOriginal,
  });
  const diretores = (tabela: Record<number, string[]>) => async (id: number) => tabela[id] ?? [];

  it('tmdb_id do CG é certo, sem busca', async () => {
    expect(await decidirCasamento({ ...filme, tmdbId: 693134 }, [], diretores({}))).toMatchObject({ tipo: 'certo', tmdbId: 693134 });
  });

  it('título, ano (±1: estreia daqui × original) e diretor batem: certo', async () => {
    const r = await decidirCasamento(filme, [c(693134, 'Duna: Parte Dois', 2024)], diretores({ 693134: ['Denis Villeneuve'] }));
    expect(r).toMatchObject({ tipo: 'certo', tmdbId: 693134 });
  });

  it('o título original também vale', async () => {
    const r = await decidirCasamento(
      { ...filme, titulo: 'Dune: Part Two' },
      [c(693134, 'Duna: Parte Dois', 2024, 'Dune: Part Two')],
      diretores({ 693134: ['Denis Villeneuve'] }),
    );
    expect(r.tipo).toBe('certo');
  });

  it('diretor diferente: dúvida, com o candidato', async () => {
    const r = await decidirCasamento(filme, [c(1, 'Duna: Parte Dois', 2024)], diretores({ 1: ['Outra Pessoa'] }));
    expect(r).toMatchObject({ tipo: 'duvida', candidato: { tmdbId: 1 } });
  });

  it('ano longe demais (refilmagem): dúvida', async () => {
    const r = await decidirCasamento(
      { titulo: 'Como Treinar o Seu Dragão', lancamento: '2025-06-07', diretor: null, tmdbId: null },
      [c(10191, 'Como Treinar o Seu Dragão', 2010)],
      diretores({}),
    );
    expect(r.tipo).toBe('duvida');
  });

  it('sem diretor no CG: certo só com um candidato no ano exato', async () => {
    const semDiretor = { ...filme, diretor: null };
    expect((await decidirCasamento(semDiretor, [c(1, 'Duna: Parte Dois', 2024)], diretores({}))).tipo).toBe('certo');
    expect(
      (await decidirCasamento(semDiretor, [c(1, 'Duna: Parte Dois', 2024), c(2, 'Duna: Parte Dois', 2023)], diretores({}))).tipo,
    ).toBe('duvida');
  });

  it('busca vazia: sem candidato', async () => {
    expect((await decidirCasamento(filme, [], diretores({}))).tipo).toBe('sem_candidato');
  });
});
