import { describe, expect, it } from 'vitest';
import { omdbConfig } from '../../config/metadata';
import naoEncontrado from './__fixtures__/nao-encontrado.json';
import notaNa from './__fixtures__/nota-na.json';
import notasDuna from './__fixtures__/notas-duna-parte-2.json';
import semRt from './__fixtures__/sem-rotten-tomatoes.json';
import { normalizarNotas, notaImdb, notaRottenTomatoes, precisaAtualizarNotas } from './omdb.parse';
import { omdbResponseSchema, omdbSucessoSchema } from './omdb.schemas';

/** Fixtures reais do OMDb, capturadas em 22/09/2026. */

describe('schema discrimina sucesso de falha pelo corpo, não pelo status', () => {
  it('reconhece a resposta boa', () => {
    const r = omdbResponseSchema.safeParse(notasDuna);
    expect(r.success && r.data.Response).toBe('True');
  });

  it('reconhece a falha que vem com HTTP 200', () => {
    // esta é A armadilha do OMDb: status 200, Response "False"
    const r = omdbResponseSchema.safeParse(naoEncontrado);
    expect(r.success).toBe(true);
    expect(r.success && r.data.Response).toBe('False');
    expect(r.success && r.data.Response === 'False' && r.data.Error).toBe('Incorrect IMDb ID.');
  });
});

describe('extração de notas', () => {
  it('pega IMDb e Rotten Tomatoes de Duna: Parte Dois', () => {
    const notas = normalizarNotas(omdbSucessoSchema.parse(notasDuna));
    expect(notas.imdbRating).toBe(8.4);
    expect(notas.rtRating).toBe(92);
    expect(notas.imdbId).toBe('tt15239678');
  });

  it('aceita filme sem Rotten Tomatoes', () => {
    const notas = normalizarNotas(omdbSucessoSchema.parse(semRt));
    expect(notas.imdbRating).toBe(7.5);
    expect(notas.rtRating).toBeNull();
  });

  it('trata "N/A" como ausência, não como número', () => {
    // Number.parseFloat('N/A') é NaN; gravar NaN no banco seria nota inventada
    const notas = normalizarNotas(omdbSucessoSchema.parse(notaNa));
    expect(notas.imdbRating).toBeNull();
    expect(notas.rtRating).toBeNull();
  });
});

describe('conversão de valores', () => {
  it('converte nota do IMDb', () => {
    expect(notaImdb('8.4')).toBe(8.4);
    expect(notaImdb('10.0')).toBe(10);
    expect(notaImdb('N/A')).toBeNull();
    expect(notaImdb('')).toBeNull();
    expect(notaImdb(null)).toBeNull();
    expect(notaImdb('11')).toBeNull(); // fora da escala
  });

  it('converte percentual do Rotten Tomatoes', () => {
    expect(notaRottenTomatoes('92%')).toBe(92);
    expect(notaRottenTomatoes('100%')).toBe(100);
    expect(notaRottenTomatoes('0%')).toBe(0);
    expect(notaRottenTomatoes('N/A')).toBeNull();
    expect(notaRottenTomatoes('8.4/10')).toBeNull(); // formato do IMDb, não do RT
    expect(notaRottenTomatoes('101%')).toBeNull();
  });
});

describe('cadência de atualização (§5.3)', () => {
  const agora = new Date('2026-09-22T12:00:00Z');
  const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);

  it('sempre atualiza quando nunca foi consultado', () => {
    expect(precisaAtualizarNotas(dias(30), null, omdbConfig, agora)).toBe(true);
  });

  it('na primeira semana após a estreia, atualiza diariamente', () => {
    const estreouOntem = dias(1);
    expect(precisaAtualizarNotas(estreouOntem, dias(1), omdbConfig, agora)).toBe(true);
    expect(precisaAtualizarNotas(estreouOntem, agora, omdbConfig, agora)).toBe(false);
  });

  it('depois da primeira semana, atualiza semanalmente', () => {
    const estreouHaUmMes = dias(30);
    expect(precisaAtualizarNotas(estreouHaUmMes, dias(3), omdbConfig, agora)).toBe(false);
    expect(precisaAtualizarNotas(estreouHaUmMes, dias(8), omdbConfig, agora)).toBe(true);
  });

  it('filme que ainda vai estrear usa a cadência conservadora', () => {
    const estreiaDaquiUmMes = new Date(agora.getTime() + 30 * 86_400_000);
    expect(precisaAtualizarNotas(estreiaDaquiUmMes, dias(3), omdbConfig, agora)).toBe(false);
    expect(precisaAtualizarNotas(estreiaDaquiUmMes, dias(8), omdbConfig, agora)).toBe(true);
  });

  it('sem data de estreia, usa a cadência conservadora', () => {
    expect(precisaAtualizarNotas(null, dias(3), omdbConfig, agora)).toBe(false);
    expect(precisaAtualizarNotas(null, dias(8), omdbConfig, agora)).toBe(true);
  });
});
