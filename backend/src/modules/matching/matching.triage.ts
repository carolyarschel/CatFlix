import { triageRules } from '../../config/matching';
import { basico } from './matching.normalizer';

/**
 * Triagem "isso é filme?" (§7.2, estágio 1).
 *
 * É o filtro que mais evita falso positivo, e por um motivo que só apareceu ao
 * sondar as APIs: os não-filmes **existem no TMDB e casam bem**. Rammstein,
 * Queen, BTS e Maiara & Maraisa têm entrada lá, com título e ano batendo. Sem
 * este estágio, o matching aceitaria todos com confiança alta e eles apareceriam
 * na home no meio de Duna e A Odisseia.
 *
 * Os dois sinais que o contexto previa não funcionam como escrito:
 *   - `type` do ingresso é SEMPRE "Filme", inclusive em show e ópera
 *   - distribuidor nunca é nulo: vem a string literal "Sem Distribuidor"
 *
 * Nenhum sinal sozinho condena. A triagem soma suspeitas e, acima do limiar,
 * manda para revisão humana — nunca descarta por conta própria.
 */

export interface SinalDeTriagem {
  sinal: string;
  peso: number;
  detalhe: string;
}

export interface ResultadoTriagem {
  /** soma dos pesos, 0 a 1 (saturado) */
  suspeita: number;
  provavelmenteNaoEhFilme: boolean;
  sinais: SinalDeTriagem[];
}

/** Acima disto, o evento é tratado como provável não-filme. */
const LIMIAR_DE_SUSPEITA = 0.6;

function contemPalavra(texto: string, termo: string): boolean {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // limite de palavra é essencial: sem ele "opera" casa dentro de "operacao"
  return new RegExp(`\\b${escapado}\\b`).test(texto);
}

export interface EntradaDaTriagem {
  title: string;
  runtimeMinutes: number | null;
  distributor: string | null;
  /** gêneros do TMDB, quando o candidato já foi consultado — o sinal mais forte */
  tmdbGenres?: string[];
}

export function triar(entrada: EntradaDaTriagem): ResultadoTriagem {
  const sinais: SinalDeTriagem[] = [];
  const titulo = basico(entrada.title);
  const distribuidor = entrada.distributor ? basico(entrada.distributor) : null;

  // 1. duração de curta — pega programa infantil e curta, não pega show de 195 min
  if (entrada.runtimeMinutes !== null && entrada.runtimeMinutes < triageRules.minRuntimeMinutes) {
    sinais.push({
      sinal: 'duracao_curta',
      peso: 0.5,
      detalhe: `${entrada.runtimeMinutes} min, abaixo de ${triageRules.minRuntimeMinutes}`,
    });
  }

  // 2. "Sem Distribuidor" — literal, nunca nulo (CONTRATO.md §5)
  if (distribuidor && triageRules.nonFilmDistributors.some((d) => distribuidor === basico(d))) {
    sinais.push({ sinal: 'sem_distribuidor', peso: 0.5, detalhe: entrada.distributor! });
  }

  // 3. distribuidora cujo catálogo é show e transmissão
  if (distribuidor) {
    const casada = triageRules.eventDistributors.find((d) => contemPalavra(distribuidor, basico(d)));
    if (casada) {
      sinais.push({ sinal: 'distribuidora_de_evento', peso: 0.5, detalhe: entrada.distributor! });
    }
  }

  // 4. palavra-chave de evento no título
  const palavras = triageRules.keywords.filter((k) => contemPalavra(titulo, basico(k)));
  if (palavras.length > 0) {
    sinais.push({
      sinal: 'palavra_chave_de_evento',
      peso: Math.min(0.4 + 0.2 * (palavras.length - 1), 0.7),
      detalhe: palavras.join(', '),
    });
  }

  // 5. gênero do TMDB — só existe depois de consultar o candidato, e é o único
  //    sinal que pega show com distribuidora normal e duração de longa.
  //
  //    A discriminação fina está na COMBINAÇÃO, não no gênero solto:
  //      Música + Documentário → show filmado (LINKIN PARK, Rammstein)
  //      Música + Fantasia     → musical de ficção (Wicked) — filme legítimo
  //    Por isso o combo pesa quase o limiar inteiro e o gênero avulso pesa pouco.
  if (entrada.tmdbGenres?.length) {
    const generos = entrada.tmdbGenres.map(basico);

    const combo = triageRules.eventGenreCombos.find((c) =>
      c.every((g) => generos.includes(basico(g))),
    );

    if (combo) {
      sinais.push({ sinal: 'combo_de_genero_de_evento', peso: 0.65, detalhe: combo.join(' + ') });
    } else {
      const casados = triageRules.eventGenresTmdb.filter((g) => generos.includes(basico(g)));
      if (casados.length > 0) {
        sinais.push({ sinal: 'genero_tmdb_de_evento', peso: 0.25, detalhe: casados.join(', ') });
      }
    }
  }

  const suspeita = Math.min(
    sinais.reduce((soma, s) => soma + s.peso, 0),
    1,
  );

  return {
    suspeita,
    provavelmenteNaoEhFilme: suspeita >= LIMIAR_DE_SUSPEITA,
    sinais,
  };
}

export const limiarDeSuspeita = LIMIAR_DE_SUSPEITA;
