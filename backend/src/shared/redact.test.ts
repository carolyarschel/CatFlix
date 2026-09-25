import { describe, expect, it } from 'vitest';
import { redigirParametros, redigirUrl } from './redact';

/**
 * O TMDB e o OMDb autenticam por query string. Sem redação, as chaves da
 * Carol ficariam em texto puro no Postgres, em cada linha de RawPayload.
 */

describe('redigirUrl', () => {
  it('esconde a chave do TMDB', () => {
    const url = redigirUrl('https://api.themoviedb.org/3/movie/693134?api_key=segredo123&language=pt-BR');
    expect(url).not.toContain('segredo123');
    expect(url).toContain('api_key=%5Bredigido%5D');
    // o resto continua legível, senão o log perde utilidade
    expect(url).toContain('language=pt-BR');
  });

  it('esconde a chave do OMDb', () => {
    expect(redigirUrl('https://www.omdbapi.com/?apikey=7fa352b2&i=tt15239678')).not.toContain('7fa352b2');
  });

  it('não mexe em URL sem segredo', () => {
    const url = 'https://api-content.ingresso.com/v0/theaters/city/14/partnership/www';
    expect(redigirUrl(url)).toBe(url);
  });

  it('devolve como veio se não for URL válida', () => {
    expect(redigirUrl('isto não é uma url')).toBe('isto não é uma url');
  });
});

describe('redigirParametros', () => {
  it('esconde só os parâmetros secretos', () => {
    expect(redigirParametros({ api_key: 'segredo', language: 'pt-BR', query: 'Duna' })).toEqual({
      api_key: '[redigido]',
      language: 'pt-BR',
      query: 'Duna',
    });
  });

  it('não se importa com maiúsculas', () => {
    expect(redigirParametros({ ApiKey: 'segredo' })).toEqual({ ApiKey: '[redigido]' });
  });
});
