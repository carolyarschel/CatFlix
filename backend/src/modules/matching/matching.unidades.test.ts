import { describe, expect, it } from 'vitest';
import { basico, normalizarNumerais, normalizarTitulo } from './matching.normalizer';
import { calcularScore, pontuarAno, pontuarCreditos, pontuarDuracao } from './matching.score';
import { triar } from './matching.triage';
import { similaridade, trigramas } from './matching.trigram';

describe('normalizador', () => {
  it('tira o que descreve a sessão, não a obra', () => {
    expect(normalizarTitulo('DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX').normalizado).toBe('duna parte 2');
    expect(normalizarTitulo('O BRUTALISTA (LEG)').normalizado).toBe('o brutalista');
    expect(normalizarTitulo('Toy Story 5 - Dublado').normalizado).toBe('toy story 5');
    expect(normalizarTitulo('DIVERTIDAMENTE 2 - SESSÃO KIDS').normalizado).toBe('divertidamente 2');
  });

  it('remove os termos mais longos primeiro', () => {
    // "reexibicao especial" tem de sair inteiro; se "reexibicao" saísse antes,
    // sobraria um "especial" órfão grudado no título
    const n = normalizarTitulo('DUNA - REEXIBIÇÃO ESPECIAL');
    expect(n.normalizado).toBe('duna');
  });

  it('limpa conectivo pendurado depois da remoção', () => {
    // "Akira (Remasterizado Em 4K)" virava "akira em 4k"
    expect(normalizarTitulo('Akira (Remasterizado)').normalizado).toBe('akira');
  });

  it('não estraga título que só parece ter sufixo', () => {
    expect(normalizarTitulo('Um Sonho de Liberdade').normalizado).toBe('um sonho de liberdade');
    expect(normalizarTitulo('Operação Fronteira').normalizado).toBe('operacao fronteira');
    expect(normalizarTitulo('O Brutalista').normalizado).toBe('o brutalista');
  });

  it('carrega a versão da configuração, para a decisão seguir explicável', () => {
    expect(normalizarTitulo('Duna').versaoDaConfig).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });
});

describe('numerais por extenso', () => {
  it('converte depois de "parte"', () => {
    expect(normalizarNumerais('duna parte dois')).toBe('duna parte 2');
    expect(normalizarNumerais('john wick capitulo quatro')).toBe('john wick capitulo 4');
  });

  it('converte quando é a última palavra', () => {
    expect(normalizarNumerais('tropa de elite dois')).toBe('tropa de elite 2');
  });

  it('NÃO converte em posição perigosa', () => {
    // estes são os títulos que uma conversão ingênua estragaria
    expect(normalizarNumerais('um sonho de liberdade')).toBe('um sonho de liberdade');
    expect(normalizarNumerais('tres homens em conflito')).toBe('tres homens em conflito');
    expect(normalizarNumerais('dois filhos de francisco')).toBe('dois filhos de francisco');
  });

  it('é o que salva o caso 1 do §7.4', () => {
    const a = 'duna parte 2';
    const b = normalizarNumerais('duna parte dois');
    expect(similaridade(a, 'duna parte dois')).toBeCloseTo(0.647, 2);
    expect(similaridade(a, b)).toBe(1);
  });
});

describe('trigramas', () => {
  it('monta como o Postgres monta', () => {
    // "  oi " → "  o", " oi", "oi "
    expect([...trigramas('oi')].sort()).toEqual(['  o', ' oi', 'oi ']);
  });

  it('texto sem alfanumérico dá 0, não NaN', () => {
    expect(similaridade('---', '...')).toBe(0);
    expect(similaridade('', 'duna')).toBe(0);
  });

  it('é simétrica', () => {
    expect(similaridade('duna parte 2', 'duna')).toBe(similaridade('duna', 'duna parte 2'));
  });
});

describe('triagem', () => {
  it('pega ópera ao vivo', () => {
    const r = triar({ title: 'MET ÓPERA: LA BOHÈME AO VIVO', runtimeMinutes: 195, distributor: 'Trafalgar' });
    expect(r.provavelmenteNaoEhFilme).toBe(true);
  });

  it('pega "Sem Distribuidor", que é literal e não nulo', () => {
    const r = triar({
      title: 'Ozzy & Black Sabbath - Back To The Beginning',
      runtimeMinutes: 147,
      distributor: 'Sem Distribuidor',
    });
    expect(r.sinais.map((s) => s.sinal)).toContain('sem_distribuidor');
  });

  it('a COMBINAÇÃO Música+Documentário denuncia show', () => {
    // sozinho, "Música" não passa do limiar; combinado com "Documentário", sim
    const soMusica = triar({ title: 'X', runtimeMinutes: 110, distributor: 'Sato Company', tmdbGenres: ['Música'] });
    const combo = triar({ title: 'X', runtimeMinutes: 110, distributor: 'Sato Company', tmdbGenres: ['Música', 'Documentário'] });
    expect(soMusica.provavelmenteNaoEhFilme).toBe(false);
    expect(combo.provavelmenteNaoEhFilme).toBe(true);
  });

  it('usa o gênero do TMDB, o sinal mais forte', () => {
    // LINKIN PARK vem pela Sato Company, distribuidora normal de anime:
    // só o gênero do TMDB denuncia
    const sem = triar({ title: 'LINKIN PARK: UNSHATTER', runtimeMinutes: 110, distributor: 'Sato Company' });
    const com = triar({
      title: 'LINKIN PARK: UNSHATTER',
      runtimeMinutes: 110,
      distributor: 'Sato Company',
      tmdbGenres: ['Documentário', 'Música'],
    });
    expect(com.suspeita).toBeGreaterThan(sem.suspeita);
  });

  it('não condena musical de ficção só pelo gênero', () => {
    const r = triar({
      title: 'Wicked',
      runtimeMinutes: 160,
      distributor: 'Universal Pictures Brasil',
      tmdbGenres: ['Música', 'Fantasia'],
    });
    expect(r.provavelmenteNaoEhFilme).toBe(false);
  });

  it('curta-metragem cai pela duração', () => {
    const r = triar({ title: 'Curta Qualquer', runtimeMinutes: 22, distributor: 'Independente' });
    expect(r.sinais.map((s) => s.sinal)).toContain('duracao_curta');
  });

  it('filme comum passa limpo', () => {
    const r = triar({ title: 'A Odisseia', runtimeMinutes: 172, distributor: 'Universal Pictures Brasil' });
    expect(r.provavelmenteNaoEhFilme).toBe(false);
    expect(r.suspeita).toBe(0);
  });
});

describe('componentes do score', () => {
  it('duração: igual até a tolerância, depois decai', () => {
    expect(pontuarDuracao(166, 166)).toBe(1);
    expect(pontuarDuracao(166, 172)).toBe(1); // dentro dos 7 min
    expect(pontuarDuracao(166, 186)).toBe(0); // 20 min
    expect(pontuarDuracao(166, 180)).toBeGreaterThan(0);
    expect(pontuarDuracao(166, 180)).toBeLessThan(1);
  });

  it('ano: exato vale tudo, um de diferença vale metade', () => {
    expect(pontuarAno(2024, 2024)).toBe(1);
    expect(pontuarAno(2024, 2025)).toBe(0.5);
    expect(pontuarAno(2024, 2026)).toBe(0.2);
    expect(pontuarAno(2024, 2030)).toBe(0);
  });

  it('créditos: null quando não dá para comparar', () => {
    expect(pontuarCreditos({ directorNames: [], castNames: [] }, { directorNames: ['X'] })).toBeNull();
    expect(pontuarCreditos({ directorNames: ['X'], castNames: [] }, {})).toBeNull();
    expect(
      pontuarCreditos({ directorNames: ['Denis Villeneuve'], castNames: [] }, { directorNames: ['Denis Villeneuve'] }),
    ).toBe(1);
  });
});

describe('redistribuição de peso', () => {
  const alvo = {
    normalizado: 'duna parte 2',
    semEspacos: 'dunaparte2',
    year: 2024,
    runtimeMinutes: 166,
    directorNames: [],
    castNames: [],
  };
  const candidato = {
    normalizado: 'duna parte 2',
    semEspacos: 'dunaparte2',
    year: 2024,
    // filme já lançado: o ano conta como evidência
    releaseDate: new Date('2024-02-27'),
    runtimeMinutes: 166,
  };

  it('sem crédito, o score perfeito ainda é 1,0', () => {
    // se o ausente contasse zero, o teto seria 0,9 e NENHUMA reexibição
    // passaria do limiar de 0,92
    const r = calcularScore(alvo, candidato);
    expect(r.total).toBe(1);
    expect(r.ignorados).toEqual(['credits']);
  });

  it('só com título, o score ainda é uma escala 0–1 honesta', () => {
    const r = calcularScore(
      { ...alvo, year: null, runtimeMinutes: null },
      { ...candidato, year: null, runtimeMinutes: null },
    );
    expect(r.total).toBe(1);
    expect(r.ignorados).toEqual(['runtime', 'year', 'credits']);
  });

  it('mantém os pesos relativos do §7.2 entre os componentes presentes', () => {
    // título errado, resto certo: 0 * (0.5/0.9) + 1 * (0.4/0.9) = 0.444
    const r = calcularScore(alvo, { ...candidato, normalizado: 'xxxxx', semEspacos: 'xxxxx' });
    expect(r.total).toBeCloseTo(0.4 / 0.9, 3);
  });
});

describe('ano é fato ou estimativa — achado da fila real', () => {
  const alvo = {
    normalizado: 'os incriveis 3',
    semEspacos: 'osincriveis3',
    year: 2026,
    runtimeMinutes: null,
    directorNames: ['Brad Bird'],
    castNames: [],
  };

  const base = {
    normalizado: 'os incriveis 3',
    semEspacos: 'osincriveis3',
    year: 2028,
    runtimeMinutes: null,
    directorNames: ['Brad Bird'],
    castNames: [],
  };

  it('filme NÃO lançado: o ano é descartado, não zerado', () => {
    // 98 pendências vieram disto: título 1,00 e elenco 1,00, mas o ingresso
    // anuncia 2026 e o TMDB estima 2028 — e os dois estão "certos"
    const futuro = calcularScore(alvo, { ...base, releaseDate: new Date('2028-06-01') });

    expect(futuro.ignorados).toContain('year:estimativa');
    expect(futuro.componentes.year).toBeUndefined();
    expect(futuro.total).toBe(1);
  });

  it('sem data nenhuma, o ano também é estimativa', () => {
    const semData = calcularScore(alvo, { ...base, releaseDate: null });
    expect(semData.ignorados).toContain('year:estimativa');
  });

  it('filme JÁ lançado: o ano conta contra, como sempre contou', () => {
    // é isto que mantém o caso 3 do §7.4 indo para revisão
    const lancado = calcularScore(
      { ...alvo, year: 2025 },
      { ...base, year: 2024, releaseDate: new Date('2024-12-20') },
    );

    expect(lancado.componentes.year?.valor).toBe(0.5);
    expect(lancado.total).toBeLessThan(0.92);
  });
});

describe('ano brasileiro — o campo do ingresso é ambíguo', () => {
  const alvo = (ano: number) => ({
    normalizado: 'o brutalista',
    semEspacos: 'obrutalista',
    year: ano,
    runtimeMinutes: 215,
    directorNames: [],
    castNames: [],
  });

  it('O Brutalista: o ano brasileiro salva o match', () => {
    // ingresso 2025 · global 2024 · Brasil 2025-02-20
    const r = calcularScore(alvo(2025), {
      normalizado: 'o brutalista',
      semEspacos: 'obrutalista',
      year: 2024,
      releaseDate: new Date('2024-12-20'),
      yearBr: 2025,
      releaseDateBr: new Date('2025-02-20'),
      runtimeMinutes: 215,
    });

    expect(r.componentes.year?.valor).toBe(1);
    expect(r.componentes.year?.detalhe).toContain('Brasil');
  });

  it('Lago dos Ossos: o global continua valendo quando é ele que bate melhor', () => {
    // ingresso 2024 · global 2025 · Brasil 2026 — trocar por BR pioraria
    const r = calcularScore(alvo(2024), {
      normalizado: 'lago dos ossos',
      semEspacos: 'lagodosossos',
      year: 2025,
      releaseDate: new Date('2025-10-02'),
      yearBr: 2026,
      releaseDateBr: new Date('2026-09-24'),
      runtimeMinutes: 100,
    });

    expect(r.componentes.year?.valor).toBe(0.5);
    expect(r.componentes.year?.detalhe).toContain('global');
  });

  it('sem ano brasileiro, usa o global como antes', () => {
    const r = calcularScore(alvo(2024), {
      normalizado: 'o brutalista',
      semEspacos: 'obrutalista',
      year: 2024,
      releaseDate: new Date('2024-12-20'),
      runtimeMinutes: 215,
    });
    expect(r.componentes.year?.valor).toBe(1);
  });
});
