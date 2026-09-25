import { describe, expect, it } from 'vitest';
import { decidir } from './matching.engine';
import type { CandidatoAvaliado, FontesDeMatching, TituloExistente } from './matching.types';
import { normalizarTitulo } from './matching.normalizer';
import { similaridade } from './matching.trigram';

/**
 * OS QUATRO CASOS OBRIGATÓRIOS DA SEÇÃO 7.4 DO CONTEXTO.
 *
 * Critério de aceite nº 4 do projeto. Se um destes quebrar, o matching
 * regrediu — não relaxe o teste, conserte o motor.
 *
 * Os dados dos candidatos são REAIS, conferidos contra o TMDB e o OMDb em
 * 22/09/2026 (ver os CONTRATO.md dos módulos de fonte).
 */

// ── dados reais do TMDB ──────────────────────────────────────

const DUNA_PARTE_DOIS: CandidatoAvaliado = {
  tmdbId: 693134,
  title: 'Duna: Parte Dois',
  originalTitle: 'Dune: Part Two',
  year: 2024,
  releaseDate: new Date('2024-02-27'),
  runtimeMinutes: 166,
  genres: ['Ficção científica', 'Aventura'],
  directorNames: ['Denis Villeneuve'],
  castNames: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson'],
};

const O_BRUTALISTA: CandidatoAvaliado = {
  tmdbId: 549509,
  title: 'O Brutalista',
  originalTitle: 'The Brutalist',
  year: 2024,
  // já estreou: o ano é FATO, então a divergência conta contra o match
  releaseDate: new Date('2024-12-20'),
  runtimeMinutes: 215,
  genres: ['Drama'],
  directorNames: ['Brady Corbet'],
  castNames: ['Adrien Brody', 'Felicity Jones', 'Guy Pearce'],
};

const DIVERTIDA_MENTE_2_EXISTENTE: TituloExistente = {
  id: 'title-divertida-mente-2',
  title: 'Divertida Mente 2',
  normalizedTitle: 'divertida mente 2',
  normalizedOriginalTitle: 'inside out 2',
  year: 2024,
  runtimeMinutes: 100,
  tmdbId: 1022789,
};

// ── porta de fontes, controlada pelo teste ───────────────────

function fontes(opcoes: {
  cache?: { titleId: string } | null;
  existentes?: TituloExistente[];
  tmdb?: CandidatoAvaliado[];
}): FontesDeMatching {
  return {
    buscarDecisaoEmCache: async () => opcoes.cache ?? null,
    // simula o índice trigrama do Postgres: só devolve o que tem alguma semelhança
    buscarTitulosParecidos: async (normalizado) =>
      (opcoes.existentes ?? []).filter(
        (t) =>
          similaridade(normalizado, t.normalizedTitle) >= 0.3 ||
          similaridade(normalizado.replace(/\s/g, ''), t.normalizedTitle.replace(/\s/g, '')) >= 0.3,
      ),
    buscarCandidatosTmdb: async () => opcoes.tmdb ?? [],
  };
}

// ── os quatro casos ──────────────────────────────────────────

describe('§7.4 caso 1 — DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX', () => {
  it('casa com Dune: Part Two depois da normalização', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '21157',
        title: 'DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX',
        // reexibição costuma vir sem título original no ingresso
        originalTitle: null,
        year: 2024,
        runtimeMinutes: 166,
        distributor: 'Warner Bros',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ tmdb: [DUNA_PARTE_DOIS] }),
    );

    expect(decisao.outcome).toBe('accepted');
    expect(decisao.candidateTmdbId).toBe(693134);
    expect(decisao.score!.total).toBeGreaterThanOrEqual(0.92);
  });

  it('a normalização é o que faz o caso funcionar', () => {
    // "reexibicao especial" e "imax" descrevem a SESSÃO, não a obra
    const n = normalizarTitulo('DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX');
    expect(n.normalizado).toBe('duna parte 2');
    expect(n.removidos).toContain('imax');

    // e "Parte Dois" → "parte 2" é o que leva a similaridade de 0,647 para 1,0
    expect(normalizarTitulo('Duna: Parte Dois').normalizado).toBe('duna parte 2');
  });

  it('sem crédito nenhum do ingresso, o peso é redistribuído', async () => {
    // se o componente ausente contasse zero, o teto seria 0,9 e este caso
    // jamais passaria do limiar de 0,92
    const decisao = await decidir(
      {
        ingressoEventId: '21157',
        title: 'DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX',
        originalTitle: null,
        year: 2024,
        runtimeMinutes: 166,
        distributor: 'Warner Bros',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ tmdb: [DUNA_PARTE_DOIS] }),
    );

    expect(decisao.score!.ignorados).toContain('credits');
    expect(decisao.score!.componentes.credits).toBeUndefined();
  });
});

describe('§7.4 caso 2 — MET ÓPERA: LA BOHÈME AO VIVO', () => {
  it('cai na triagem como not_a_film', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '99001',
        title: 'MET ÓPERA: LA BOHÈME AO VIVO',
        originalTitle: null,
        year: 2026,
        runtimeMinutes: 195,
        distributor: 'Trafalgar',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({}),
    );

    expect(decisao.outcome).toBe('not_a_film');
    expect(decisao.stage).toBe('triage');
    expect(decisao.reviewReason).toBe('probable_non_film');
  });

  it('nem a duração de 195 min nem o type "Filme" o salvariam', async () => {
    // o corte de 40 min não pega, e o `type` do ingresso é sempre "Filme":
    // quem pega são as palavras-chave e a distribuidora de evento
    const decisao = await decidir(
      {
        ingressoEventId: '99001',
        title: 'MET ÓPERA: LA BOHÈME AO VIVO',
        originalTitle: null,
        year: 2026,
        runtimeMinutes: 195,
        distributor: 'Trafalgar',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({}),
    );

    const sinais = decisao.triagem!.sinais.map((s) => s.sinal);
    expect(sinais).toContain('palavra_chave_de_evento');
    expect(sinais).toContain('distribuidora_de_evento');
    expect(sinais).not.toContain('duracao_curta');
  });

  it('não confunde "ópera" com "operação"', async () => {
    // sem limite de palavra, "Operação Fronteira" viraria ópera
    const decisao = await decidir(
      {
        ingressoEventId: '99002',
        title: 'Operação Fronteira',
        originalTitle: null,
        year: 2026,
        runtimeMinutes: 110,
        distributor: 'Paris Filmes',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({}),
    );

    expect(decisao.outcome).not.toBe('not_a_film');
  });
});

describe('§7.4 caso 3 — O BRUTALISTA (LEG)', () => {
  it('com divergência de ano, vai para revisão com o candidato', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '32131',
        title: 'O BRUTALISTA (LEG)',
        originalTitle: null,
        // 2024 no TMDB, 2025 no cartaz brasileiro
        year: 2025,
        runtimeMinutes: 215,
        distributor: 'Universal Pictures Brasil',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ tmdb: [O_BRUTALISTA] }),
    );

    expect(decisao.outcome).toBe('review');
    expect(decisao.reviewReason).toBe('low_confidence');
    expect(decisao.candidateTmdbId).toBe(549509);
    expect(decisao.score!.total).toBeGreaterThanOrEqual(0.75);
    expect(decisao.score!.total).toBeLessThan(0.92);
  });

  it('é a divergência de ano que segura — com o ano certo, aceita sozinho', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '32131',
        title: 'O BRUTALISTA (LEG)',
        originalTitle: null,
        year: 2024,
        runtimeMinutes: 215,
        distributor: 'Universal Pictures Brasil',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ tmdb: [O_BRUTALISTA] }),
    );

    expect(decisao.outcome).toBe('accepted');
  });
});

describe('§7.4 caso 4 — DIVERTIDAMENTE 2 - SESSÃO KIDS', () => {
  it('é reconhecido como o mesmo filme do Divertida Mente 2 já existente', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '33076',
        title: 'DIVERTIDAMENTE 2 - SESSÃO KIDS',
        originalTitle: null,
        year: 2024,
        runtimeMinutes: 100,
        distributor: 'Disney',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ existentes: [DIVERTIDA_MENTE_2_EXISTENTE] }),
    );

    expect(decisao.outcome).toBe('accepted');
    expect(decisao.titleId).toBe('title-divertida-mente-2');
    // NÃO cria Title novo: é mais um id do ingresso apontando para o mesmo
    expect(decisao.reason).toContain('já no catálogo');
  });

  it('a comparação sem espaço é o que resolve', () => {
    const a = normalizarTitulo('DIVERTIDAMENTE 2 - SESSÃO KIDS');
    const b = normalizarTitulo('Divertida Mente 2');

    expect(similaridade(a.normalizado, b.normalizado)).toBeCloseTo(0.75, 2);
    expect(similaridade(a.semEspacos, b.semEspacos)).toBe(1);
  });

  it('o Title existente ganha do TMDB, para não duplicar', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '33076',
        title: 'DIVERTIDAMENTE 2 - SESSÃO KIDS',
        originalTitle: null,
        year: 2024,
        runtimeMinutes: 100,
        distributor: 'Disney',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({
        existentes: [DIVERTIDA_MENTE_2_EXISTENTE],
        tmdb: [
          {
            tmdbId: 1022789,
            title: 'Divertida Mente 2',
            originalTitle: 'Inside Out 2',
            year: 2024,
            releaseDate: new Date('2024-06-13'),
            runtimeMinutes: 100,
            genres: ['Animação'],
            directorNames: ['Kelsey Mann'],
            castNames: [],
          },
        ],
      }),
    );

    expect(decisao.titleId).toBe('title-divertida-mente-2');
    expect(decisao.outcome).toBe('accepted');
  });
});

/**
 * Regressões pegas ao rodar o pipeline contra as sessões reais de Campinas
 * (34 eventos, 22/09/2026). Cada uma destas passou despercebida pelos quatro
 * casos do §7.4 e só apareceu com dado de verdade.
 */
describe('regressões do primeiro contato com dado real', () => {
  const LINKIN_PARK: CandidatoAvaliado = {
    tmdbId: 1489608,
    title: 'LINKIN PARK: UNSHATTER',
    originalTitle: 'LINKIN PARK: UNSHATTER',
    year: 2026,
    releaseDate: new Date('2026-01-15'),
    runtimeMinutes: 110,
    genres: ['Música', 'Documentário'],
    directorNames: [],
    castNames: [],
  };

  it('o match forte NÃO pula a triagem por gênero', async () => {
    // Título, ano e duração batem exatamente, a distribuidora é normal (Sato
    // Company também lança anime) e são 110 min. Antes da correção, o estágio
    // 2 encerrava a decisão e o show entrava na home como filme.
    const decisao = await decidir(
      {
        ingressoEventId: '33012',
        title: 'LINKIN PARK: UNSHATTER',
        originalTitle: 'LINKIN PARK: UNSHATTER',
        year: 2026,
        runtimeMinutes: 110,
        distributor: 'Sato Company',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({ tmdb: [LINKIN_PARK] }),
    );

    expect(decisao.outcome).toBe('not_a_film');
    expect(decisao.triagem!.sinais.map((s) => s.sinal)).toContain('combo_de_genero_de_evento');
  });

  it('"Encore" e "Relançamento" saem do título antes da busca', () => {
    // "vingadores ultimato encore relancamento" achava ZERO no TMDB;
    // "vingadores ultimato" acha Vingadores: Ultimato (2019)
    expect(normalizarTitulo('Vingadores: Ultimato Encore (Relançamento)').normalizado).toBe(
      'vingadores ultimato',
    );
  });
});

describe('corroboração — título sozinho não basta', () => {
  it('só o título batendo vai para revisão, mesmo com score 1,0', async () => {
    // Sem ano, sem duração e sem elenco, o score vira só a similaridade do
    // título — e 1,00 em título é fácil demais: dois filmes diferentes podem
    // se chamar igual. Aceitar isso sozinho seria confiar em nada.
    const decisao = await decidir(
      {
        ingressoEventId: '77001',
        title: 'Renascer',
        originalTitle: null,
        year: null,
        runtimeMinutes: null,
        distributor: 'Paris Filmes',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({
        tmdb: [
          {
            tmdbId: 111111,
            title: 'Renascer',
            originalTitle: 'Renascer',
            year: null,
            releaseDate: null,
            runtimeMinutes: null,
            genres: ['Drama'],
            directorNames: [],
            castNames: [],
          },
        ],
      }),
    );

    expect(decisao.score!.total).toBe(1);
    expect(decisao.outcome).toBe('review');
    expect(decisao.reason).toContain('única evidência');
  });

  it('com UM componente a mais, aceita', async () => {
    const decisao = await decidir(
      {
        ingressoEventId: '77002',
        title: 'Renascer',
        originalTitle: null,
        year: null,
        runtimeMinutes: 112,
        distributor: 'Paris Filmes',
        siteUrl: null,
        directorNames: [],
        castNames: [],
      },
      fontes({
        tmdb: [
          {
            tmdbId: 111111,
            title: 'Renascer',
            originalTitle: 'Renascer',
            year: null,
            releaseDate: null,
            runtimeMinutes: 112,
            genres: ['Drama'],
            directorNames: [],
            castNames: [],
          },
        ],
      }),
    );

    expect(decisao.outcome).toBe('accepted');
  });

  it('sufixo de aniversário sai do título', () => {
    // "Carros (20º Aniversário)" virava "carros 20o" e não achava nada
    expect(normalizarTitulo('Carros (20º Aniversário)').normalizado).toBe('carros');
    expect(normalizarTitulo('Shrek (25º Aniversário)').normalizado).toBe('shrek');
    // mas o número de sequência continua intacto
    expect(normalizarTitulo('Se Eu Fosse Você 3').normalizado).toBe('se eu fosse voce 3');
  });
});
