import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegistrarPayloadInput } from '../../shared/raw-payload';

/**
 * O que a expansão do acervo pede do TMDB (cineon-expansao §5): sinopse no
 * idioma de reserva quando a de português vem vazia, estreia no Brasil pela
 * regra certa e status de produção.
 *
 * Todas as respostas são REAIS, baixadas da API em 18/11/2026 (só os créditos
 * de Duna foram enxugados para os diretores e os 15 primeiros do elenco):
 *
 * - `movie-sem-sinopse-pt.json` — *Star Wars: Starfighter* (1417668), ainda em
 *   pós-produção, com `overview: ""` em pt-BR. Era um dos 20 filmes casados
 *   sem sinopse no banco naquele dia.
 * - `movie-sem-sinopse-reserva-en.json` — o mesmo filme em en-US.
 * - `movie-duna-parte-2-reexibicao.json` — *Duna: Parte Dois* (693134), com a
 *   estreia de 2024 (tipo 3) e a reexibição de 03/12/2026 (tipo 2) no Brasil.
 */

// a chave precisa existir antes de o config ser lido; o valor não importa,
// porque nenhum pedido sai para a rede
vi.hoisted(() => {
  process.env.TMDB_API_KEY ??= 'chave-de-teste';
});

const { registrarRawPayload } = vi.hoisted(() => ({
  registrarRawPayload: vi.fn<(input: RegistrarPayloadInput) => Promise<string>>(
    async () => 'raw-payload-1',
  ),
}));

vi.mock('../../shared/raw-payload', () => ({
  registrarRawPayload,
  ultimoPayloadBemSucedido: vi.fn(),
}));

import semSinopsePt from './__fixtures__/movie-sem-sinopse-pt.json';
import semSinopseEn from './__fixtures__/movie-sem-sinopse-reserva-en.json';
import dunaReexibicao from './__fixtures__/movie-duna-parte-2-reexibicao.json';
import { TmdbClient } from './tmdb.client';
import { estreiaNoBrasil, normalizarMetadata, precisaAtualizarMetadata } from './tmdb.parse';
import { tmdbMovieSchema } from './tmdb.schemas';

function resposta(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Responde pelo idioma pedido, como a API real. */
function simularTmdb(porIdioma: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada) => {
    const url = new URL(String(entrada instanceof Request ? entrada.url : entrada));
    const idioma = url.searchParams.get('language') ?? '';
    const corpo = porIdioma[idioma];
    if (!corpo) throw new Error(`pedido inesperado no idioma "${idioma}"`);
    return resposta(corpo);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  registrarRawPayload.mockClear();
});

describe('estreia no Brasil (§5.1)', () => {
  it('usa a estreia de cinema, não a reexibição limitada de depois', () => {
    const filme = tmdbMovieSchema.parse(dunaReexibicao);
    expect(estreiaNoBrasil(filme)?.toISOString().slice(0, 10)).toBe('2024-02-29');
  });

  it('sem estreia de cinema, aceita a limitada', () => {
    const filme = tmdbMovieSchema.parse({
      ...dunaReexibicao,
      release_dates: {
        results: [
          {
            iso_3166_1: 'BR',
            release_dates: [
              { release_date: '2026-12-03T00:00:00.000Z', type: 2 },
              { release_date: '2024-05-21T00:00:00.000Z', type: 4 },
            ],
          },
        ],
      },
    });
    expect(estreiaNoBrasil(filme)?.toISOString().slice(0, 10)).toBe('2026-12-03');
  });

  it('guarda a estreia original separada da brasileira', () => {
    const meta = normalizarMetadata(tmdbMovieSchema.parse(dunaReexibicao));
    expect(meta.releaseDate?.toISOString().slice(0, 10)).toBe('2024-02-27');
    expect(meta.releaseDateBr?.toISOString().slice(0, 10)).toBe('2024-02-29');
  });
});

describe('status de produção', () => {
  it('vem do campo status, como texto', () => {
    expect(normalizarMetadata(tmdbMovieSchema.parse(semSinopsePt)).productionStatus).toBe(
      'Post Production',
    );
    expect(normalizarMetadata(tmdbMovieSchema.parse(dunaReexibicao)).productionStatus).toBe(
      'Released',
    );
  });
});

describe('sinopse com idioma de reserva (§5.2)', () => {
  it('sinopse vazia em pt-BR busca a em en-US e marca o idioma', async () => {
    const fetch = simularTmdb({ 'pt-BR': semSinopsePt, 'en-US': semSinopseEn });

    const meta = await new TmdbClient().obterMetadata(1417668);

    expect(meta.overview).toBe(semSinopseEn.overview);
    expect(meta.overviewLanguage).toBe('en-US');
    // o resto continua vindo do pedido em português
    expect(meta.title).toBe('Star Wars: Starfighter');
    expect(meta.releaseDateBr?.toISOString().slice(0, 10)).toBe('2027-05-27');
    expect(fetch).toHaveBeenCalledTimes(2);
    // §7.1: os dois pedidos ficam guardados como bruto
    expect(registrarRawPayload).toHaveBeenCalledTimes(2);
  });

  it('o pedido de reserva é só o detalhe, sem append_to_response', async () => {
    const fetch = simularTmdb({ 'pt-BR': semSinopsePt, 'en-US': semSinopseEn });

    await new TmdbClient().obterMetadata(1417668);

    const segundo = new URL(String(fetch.mock.calls[1]![0]));
    expect(segundo.searchParams.get('language')).toBe('en-US');
    expect(segundo.searchParams.has('append_to_response')).toBe(false);
  });

  it('com sinopse em português, não faz o segundo pedido', async () => {
    const fetch = simularTmdb({ 'pt-BR': dunaReexibicao });

    const meta = await new TmdbClient().obterMetadata(693134);

    expect(meta.overviewLanguage).toBe('pt-BR');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('vazia nos dois idiomas: fica sem sinopse, sem inventar idioma', async () => {
    simularTmdb({ 'pt-BR': semSinopsePt, 'en-US': { ...semSinopseEn, overview: '' } });

    const meta = await new TmdbClient().obterMetadata(1417668);

    expect(meta.overview).toBeNull();
    expect(meta.overviewLanguage).toBeNull();
  });
});

describe('cadência do refresh de metadata (§5.3)', () => {
  const agora = new Date('2026-11-18T12:00:00Z');
  const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);
  const config = { janelaDeLancamentoDias: 90, lancamentoDias: 7, acervoDias: 90 };

  it('lançamento (estreou há menos de 90 dias) vence em 7 dias', () => {
    const filme = { releaseDate: dias(30), productionStatus: 'Released', metadataUpdatedAt: dias(6) };
    expect(precisaAtualizarMetadata(filme, config, agora)).toBe(false);
    expect(precisaAtualizarMetadata({ ...filme, metadataUpdatedAt: dias(7) }, config, agora)).toBe(true);
  });

  it('filme que ainda vai estrear também é lançamento', () => {
    const futuro = new Date(agora.getTime() + 200 * 86_400_000);
    const filme = { releaseDate: futuro, productionStatus: 'Post Production', metadataUpdatedAt: dias(8) };
    expect(precisaAtualizarMetadata(filme, config, agora)).toBe(true);
  });

  it('acervo vence em 90 dias, não em 30', () => {
    const filme = { releaseDate: dias(3000), productionStatus: 'Released', metadataUpdatedAt: dias(31) };
    expect(precisaAtualizarMetadata(filme, config, agora)).toBe(false);
    expect(precisaAtualizarMetadata({ ...filme, metadataUpdatedAt: dias(90) }, config, agora)).toBe(true);
  });

  it('sem data: anunciado é lançamento, "Released" é acervo', () => {
    const base = { releaseDate: null, metadataUpdatedAt: dias(8) };
    expect(precisaAtualizarMetadata({ ...base, productionStatus: 'Planned' }, config, agora)).toBe(true);
    expect(precisaAtualizarMetadata({ ...base, productionStatus: 'Released' }, config, agora)).toBe(false);
    expect(precisaAtualizarMetadata({ ...base, productionStatus: null }, config, agora)).toBe(true);
  });

  it('nunca atualizado vence sempre', () => {
    const filme = { releaseDate: dias(3000), productionStatus: 'Released', metadataUpdatedAt: null };
    expect(precisaAtualizarMetadata(filme, config, agora)).toBe(true);
  });
});
