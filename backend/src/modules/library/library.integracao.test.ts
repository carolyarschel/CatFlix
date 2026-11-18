import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import type { MetadataNormalizada, TmdbClient } from '../tmdb';
import { definirNota } from '../ratings';
import { listarVisualizacoes } from '../watches/watches.service';
import { adicionarALista, listarLista, restaurarNaLista } from '../watchlist/watchlist.service';
import { buscarParaAdicionar, limparCacheDeDiretores } from './library.busca';
import {
  adicionarPorTmdbId,
  darNota,
  detalheDoAcervo,
  registrarQueAssistimos,
  removerDoCatalogo,
  restaurarNoCatalogo,
} from './library.service';

/**
 * As regras do acervo do casal que cruzam módulos (cineon-expansao §3 e §4),
 * contra o banco de desenvolvimento. O TMDB é falso: as funções recebem o
 * cliente como parâmetro, e nenhum pedido sai para a rede.
 */

const PREFIXO = '__teste__acervo';
const TMDB_BASE = 990_100_000;

let temBanco = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterEach(async () => {
  if (!temBanco) return;
  limparCacheDeDiretores();
  // watches, lista e notas caem em cascata com o Title
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
  // os créditos caem com o Title, mas a pessoa é compartilhada entre filmes
  await prisma.person.deleteMany({ where: { name: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string) {
  return prisma.title.create({
    data: { title: `${PREFIXO}${sufixo}`, normalizedTitle: `${PREFIXO}${sufixo}`, status: 'matched' },
    select: { id: true },
  });
}

function metadata(tmdbId: number, parcial: Partial<MetadataNormalizada> = {}): MetadataNormalizada {
  return {
    tmdbId,
    imdbId: null,
    tvdbId: null,
    title: `${PREFIXO} TMDB ${tmdbId}`,
    originalTitle: null,
    overview: 'An overview.',
    overviewLanguage: 'en-US',
    productionStatus: 'Post Production',
    runtimeMinutes: null,
    releaseDate: new Date('2027-05-26T00:00:00Z'),
    year: 2027,
    releaseDateBr: null,
    yearBr: null,
    posterUrl: null,
    backdropUrl: null,
    genres: [],
    companies: [],
    credits: [{ tmdbId: tmdbId + 1, name: `${PREFIXO} Diretora`, profileUrl: null, role: 'director', character: null, order: null }],
    ...parcial,
  };
}

/** TMDB falso que conta quantas vezes foi chamado. */
function tmdbFalso(respostas: { metadata?: MetadataNormalizada; busca?: unknown; diretores?: string[] }) {
  const chamadas = { obterMetadata: 0, buscarDiretores: 0 };
  const cliente = {
    async obterMetadata() {
      chamadas.obterMetadata += 1;
      if (!respostas.metadata) throw new Error('não devia chamar o TMDB');
      return respostas.metadata;
    },
    async buscarFilmes() {
      return { dados: respostas.busca, rawPayloadId: 'x' };
    },
    async buscarDiretores() {
      chamadas.buscarDiretores += 1;
      return respostas.diretores ?? [];
    },
  } as unknown as TmdbClient;
  return { cliente, chamadas };
}

describe('adicionar pelo "+" (§4.1)', () => {
  it('cria pelo tmdb_id e, na segunda vez, reaproveita sem chamar o TMDB', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const tmdbId = TMDB_BASE + 1;
    const { cliente, chamadas } = tmdbFalso({ metadata: metadata(tmdbId) });

    const primeira = await adicionarPorTmdbId(tmdbId, cliente);
    const segunda = await adicionarPorTmdbId(tmdbId, cliente);

    expect(primeira.criado).toBe(true);
    expect(segunda).toEqual({ titleId: primeira.titleId, criado: false });
    expect(chamadas.obterMetadata).toBe(1);
    // filme não lançado entra com o que tem (§5.2)
    const t = await prisma.title.findUniqueOrThrow({ where: { id: primeira.titleId } });
    expect(t.productionStatus).toBe('Post Production');
    expect(t.overviewLanguage).toBe('en-US');
  });

  it('a busca marca o que já está no catálogo e tira o diretor do banco', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const noCatalogo = TMDB_BASE + 10;
    const fora = TMDB_BASE + 20;
    const { titleId } = await adicionarPorTmdbId(noCatalogo, tmdbFalso({ metadata: metadata(noCatalogo) }).cliente);

    const { cliente, chamadas } = tmdbFalso({
      busca: {
        page: 1,
        total_results: 2,
        total_pages: 1,
        results: [
          { id: noCatalogo, title: 'No catálogo', release_date: '2027-05-26' },
          { id: fora, title: 'Fora', original_title: 'Outside', release_date: '1999-01-01' },
        ],
      },
      diretores: ['Alguém'],
    });

    const itens = await buscarParaAdicionar('qualquer', cliente);

    expect(itens[0]).toMatchObject({ titleId, diretores: [`${PREFIXO} Diretora`] });
    expect(itens[1]).toMatchObject({ titleId: null, diretores: ['Alguém'], tituloOriginal: 'Outside', ano: 1999 });
    // só o de fora foi à rede
    expect(chamadas.buscarDiretores).toBe(1);

    // a mesma busca de novo usa o cache
    await buscarParaAdicionar('qualquer', cliente);
    expect(chamadas.buscarDiretores).toBe(1);
  });
});

describe('registrar que assistimos (§3.3)', () => {
  it('tira o filme da lista de quem estava, e o desfazer devolve', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-assistir');
    await adicionarALista(id, 'CAT', 4);
    await adicionarALista(id, 'BEAR', 2);

    const { visualizacao, removidosDaLista } = await registrarQueAssistimos(id, {
      data: '2026-11-14',
      local: 'CASA',
      participantes: ['CAT'],
    });

    expect(visualizacao.precisao).toBe('DIA');
    expect(removidosDaLista.map((r) => r.pessoa)).toEqual(['CAT']);
    // ele não estava: continua querendo
    const depois = await prisma.watchlistEntry.findMany({ where: { titleId: id, removedAt: null } });
    expect(depois.map((d) => d.pessoa)).toEqual(['BEAR']);

    await restaurarNaLista(removidosDaLista.map((r) => r.id));
    const restaurada = await prisma.watchlistEntry.findFirstOrThrow({ where: { titleId: id, pessoa: 'CAT' } });
    expect(restaurada.removedAt).toBeNull();
    expect(restaurada.interest).toBe(4);
  });

  it('a precisão sai do formato da data, e o futuro é recusado', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-datas');

    const mes = await registrarQueAssistimos(id, { data: '2019-07', local: 'CASA', participantes: ['CAT', 'BEAR'] });
    const ano = await registrarQueAssistimos(id, { data: '2008', local: 'CASA', participantes: ['BEAR'] });

    expect([mes.visualizacao.data, mes.visualizacao.precisao]).toEqual(['2019-07', 'MES']);
    expect([ano.visualizacao.data, ano.visualizacao.precisao]).toEqual(['2008', 'ANO']);

    await expect(
      registrarQueAssistimos(id, { data: '2999-01-01', local: 'CASA', participantes: ['CAT'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      registrarQueAssistimos(id, { data: '2026-02-31', local: 'CASA', participantes: ['CAT'] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('cinema só quando foi no cinema; cinema da base aparece pelo nome', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-cinema');
    const cine = await prisma.cinema.create({
      data: { ingressoId: `${PREFIXO}-cine`, name: `${PREFIXO} Cine`, timezone: 'America/Sao_Paulo' },
    });

    await expect(
      registrarQueAssistimos(id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT'], cinemaId: cine.id }),
    ).rejects.toBeInstanceOf(ValidationError);

    const { visualizacao } = await registrarQueAssistimos(id, {
      data: '2026-11-01',
      local: 'CINEMA',
      participantes: ['CAT', 'BEAR'],
      cinemaId: cine.id,
      tipoSala: 'IMAX',
    });
    expect(visualizacao).toMatchObject({ cinema: `${PREFIXO} Cine`, tipoSala: 'IMAX' });
  });
});

describe('nota (§3.2)', () => {
  it('só dá nota quem participou de alguma visualização', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-nota');
    await registrarQueAssistimos(id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT'] });

    await expect(darNota(id, 'BEAR', 8)).rejects.toBeInstanceOf(ConflictError);
    expect((await darNota(id, 'CAT', 8.5)).nota).toBe(8.5);
    await expect(darNota(id, 'CAT', 7.3)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('remover do catálogo (§4.4)', () => {
  it('marca tudo com um carimbo, não apaga o Title, e o desfazer volta só aquilo', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-remover');
    const antiga = await registrarQueAssistimos(id, { data: '2020', local: 'CASA', participantes: ['CAT'] });
    // apagada antes, de propósito: o desfazer não pode trazê-la de volta
    await prisma.watch.update({ where: { id: antiga.visualizacao.id }, data: { removedAt: new Date('2026-01-01') } });

    await registrarQueAssistimos(id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT', 'BEAR'] });
    await definirNota(id, 'BEAR', 9);
    await adicionarALista(id, 'CAT');

    const remocao = await removerDoCatalogo(id);
    expect(remocao).toMatchObject({ visualizacoes: 1, lista: 1, notas: 1 });
    expect(await prisma.title.count({ where: { id } })).toBe(1);

    const restauracao = await restaurarNoCatalogo(id, remocao.removidoEm);
    expect(restauracao).toEqual({ visualizacoes: 1, lista: 1, notas: 1 });
    expect(await prisma.watch.count({ where: { titleId: id, removedAt: null } })).toBe(1);
  });
});

describe('listas', () => {
  it('"os dois" é calculado: só entra quem tem as duas linhas ativas', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const ambos = await titulo('-ambos');
    const so = await titulo('-so-cat');
    await adicionarALista(ambos.id, 'CAT');
    await adicionarALista(ambos.id, 'BEAR');
    await adicionarALista(so.id, 'CAT');

    const ids = (await listarLista('AMBOS')).grupos.flatMap((g) => g.itens.map((i) => i.titleId));
    expect(ids).toContain(ambos.id);
    expect(ids).not.toContain(so.id);

    const doBear = (await listarLista('BEAR')).grupos.flatMap((g) => g.itens.map((i) => i.titleId));
    expect(doBear).not.toContain(so.id);
  });

  it('sem data vai para "Sem data"; data futura para "Estreia em breve"', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const semData = await titulo('-sem-data');
    const futuro = await prisma.title.create({
      data: {
        title: `${PREFIXO}-futuro`,
        normalizedTitle: `${PREFIXO}-futuro`,
        status: 'matched',
        releaseDateOriginal: new Date('2099-01-01T00:00:00Z'),
      },
    });
    await adicionarALista(semData.id, 'CAT');
    await adicionarALista(futuro.id, 'CAT');

    const grupos = (await listarLista('CAT')).grupos;
    const grupoDe = (titleId: string) => grupos.find((g) => g.itens.some((i) => i.titleId === titleId))?.id;
    expect(grupoDe(semData.id)).toBe('sem_data');
    expect(grupoDe(futuro.id)).toBe('estreia_em_breve');
    expect(grupos.find((g) => g.id === 'estreia_em_breve')?.itens.find((i) => i.titleId === futuro.id)?.estreiaMundial).toBe(true);
  });

  it('assistidos: filtro por quem viu junto e paginação por cursor sem repetir', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const { id } = await titulo('-paginas');
    for (const dia of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      await registrarQueAssistimos(id, { data: dia, local: 'CASA', participantes: ['CAT', 'BEAR'] });
    }
    await registrarQueAssistimos(id, { data: '2026-11-04', local: 'CASA', participantes: ['CAT'] });

    const q = PREFIXO;
    const p1 = await listarVisualizacoes({ q, pessoa: 'AMBOS', limite: 2 });
    const p2 = await listarVisualizacoes({ q, pessoa: 'AMBOS', limite: 2, cursor: p1.proximoCursor! });

    expect(p1.itens.map((i) => i.data)).toEqual(['2026-11-03', '2026-11-02']);
    expect(p2.itens.map((i) => i.data)).toEqual(['2026-11-01']);
    expect(p2.proximoCursor).toBeNull();
  });
});

describe('detalhe agregado (§7)', () => {
  it('diz, para cada pessoa, se assistiu, se quer, a nota e se pode dar nota', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const tmdbId = TMDB_BASE + 30;
    const { titleId } = await adicionarPorTmdbId(tmdbId, tmdbFalso({ metadata: metadata(tmdbId) }).cliente);
    await registrarQueAssistimos(titleId, { data: '2026-11-01', local: 'CASA', participantes: ['CAT'] });
    await darNota(titleId, 'CAT', 7);
    await adicionarALista(titleId, 'BEAR', 5);

    const d = await detalheDoAcervo(titleId, 'BEAR');

    expect(d.eu).toBe('BEAR');
    expect(d.pessoas).toEqual([
      { pessoa: 'CAT', assistiu: true, querAssistir: false, interesse: null, nota: 7, podeDarNota: true },
      { pessoa: 'BEAR', assistiu: false, querAssistir: true, interesse: 5, nota: null, podeDarNota: false },
    ]);
    expect(d.sinopseIdioma).toBe('en-US');
    expect(d.estreia).toEqual({ data: '2027-05-26', mundial: true });
    expect(d.diretores.map((p) => p.nome)).toEqual([`${PREFIXO} Diretora`]);
    expect(d.visualizacoes).toHaveLength(1);
  });
});
