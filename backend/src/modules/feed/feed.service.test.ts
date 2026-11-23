import { describe, expect, it } from 'vitest';
import { itemDaVisualizacao, lerPedido, type VisualizacaoDoFeed } from './feed.service';

const base: VisualizacaoDoFeed = {
  id: 'w1',
  watchedOn: new Date('2026-11-20T00:00:00.000Z'),
  datePrecision: 'DIA',
  location: 'CINEMA',
  participants: ['CAT', 'BEAR'],
  removedAt: null,
  title: {
    mediaType: 'movie',
    title: 'Duna: Parte Dois',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    runtimeMinutes: 166,
    posterUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
    externalIds: [
      { source: 'tmdb', externalId: '693134' },
      { source: 'imdb', externalId: 'tt15239678' },
    ],
    genres: [{ genre: { name: 'Ficção científica' } }, { genre: { name: 'Aventura' } }],
    ratings: [
      { pessoa: 'CAT', score: 9.5 },
      { pessoa: 'BEAR', score: 8 },
    ],
    comments: [
      { pessoa: 'CAT', text: 'Lindo' },
      { pessoa: 'BEAR', text: 'Sem nota não vai' },
    ],
  },
};
const quando = new Date('2026-11-21T12:00:00.000Z');

describe('itemDaVisualizacao', () => {
  it('visualização no cinema vira filme.cinema com obra, ids, duração, gêneros e notas', () => {
    expect(itemDaVisualizacao(base, quando)).toEqual({
      idNaFonte: 'watch:w1',
      tipo: 'MIDIA',
      formato: 'PONTO',
      categoria: 'filme.cinema',
      obra: {
        tipo: 'FILME',
        titulo: 'Duna: Parte Dois',
        tituloOriginal: 'Dune: Part Two',
        ano: 2024,
        capaUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
        idsExternos: { TMDB: '693134', IMDB: 'tt15239678' },
        totais: { duracaoMin: 166 },
        metadados: { generos: ['Aventura', 'Ficção científica'] },
      },
      inicio: '2026-11-20T00:00:00.000Z',
      precisaoInicio: 'DIA',
      participantes: ['BEAR', 'CAT'],
      notas: [
        { papel: 'CAT', valor: 9.5, escalaMax: 10, comentario: 'Lindo' },
        { papel: 'BEAR', valor: 8, escalaMax: 10, comentario: 'Sem nota não vai' },
      ],
      atualizadoEm: '2026-11-21T12:00:00.000Z',
    });
  });

  it('em casa vira filme.casa; comentário sem nota não vira nota', () => {
    const item = itemDaVisualizacao(
      { ...base, location: 'CASA', title: { ...base.title, ratings: [{ pessoa: 'CAT', score: 7 }] } },
      quando,
    );
    expect(item.categoria).toBe('filme.casa');
    expect(item.notas).toEqual([{ papel: 'CAT', valor: 7, escalaMax: 10, comentario: 'Lindo' }]);
  });

  it('removida sai como removido; sem nota, sem capa válida e sem duração, os campos somem', () => {
    const item = itemDaVisualizacao(
      {
        ...base,
        removedAt: new Date(),
        datePrecision: 'MES',
        title: { ...base.title, ratings: [], posterUrl: '/relativo.jpg', runtimeMinutes: null, genres: [], originalTitle: 'Duna: Parte Dois' },
      },
      quando,
    );
    expect(item.removido).toBe(true);
    expect(item.precisaoInicio).toBe('MES');
    expect(item.notas).toBeUndefined();
    expect(item.obra).not.toHaveProperty('capaUrl');
    expect(item.obra).not.toHaveProperty('totais');
    expect(item.obra).not.toHaveProperty('metadados');
    expect(item.obra).not.toHaveProperty('tituloOriginal');
  });

  it('série: obra SERIE, sem categoria (o CG ainda não definiu as de série)', () => {
    const item = itemDaVisualizacao({ ...base, title: { ...base.title, mediaType: 'series' } }, quando);
    expect(item.obra?.tipo).toBe('SERIE');
    expect(item).not.toHaveProperty('categoria');
  });

  it('só TMDB e IMDb viram id externo', () => {
    const item = itemDaVisualizacao(
      { ...base, title: { ...base.title, externalIds: [{ source: 'ingresso', externalId: '123' }, { source: 'tmdb', externalId: '1' }] } },
      quando,
    );
    expect(item.obra?.idsExternos).toEqual({ TMDB: '1' });
  });
});

describe('lerPedido', () => {
  it('padrões e limite máximo', () => {
    expect(lerPedido({})).toEqual({ desde: null, cursor: null, limite: 100 });
    expect(lerPedido({ limite: '9999' }).limite).toBe(500);
  });

  it('recusa limite, desde e cursor inválidos', () => {
    expect(() => lerPedido({ limite: '0' })).toThrow('limite');
    expect(() => lerPedido({ limite: 'abc' })).toThrow('limite');
    expect(() => lerPedido({ desde: 'ontem' })).toThrow('desde');
    expect(() => lerPedido({ cursor: 'xyz' })).toThrow('cursor');
  });

  it('lê o cursor que o próprio feed gera', () => {
    const cursor = Buffer.from(JSON.stringify({ t: '2026-11-21T12:00:00.000Z', id: 'w9' })).toString('base64url');
    expect(lerPedido({ cursor }).cursor).toEqual({ atualizadoEm: new Date('2026-11-21T12:00:00.000Z'), id: 'w9' });
  });
});
