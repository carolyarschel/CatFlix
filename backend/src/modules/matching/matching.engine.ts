import { matchThresholds, matchTolerances } from '../../config/matching';
import { logger } from '../../shared/logger';
import { normalizarTitulo } from './matching.normalizer';
import { calcularScore, type AlvoDoScore, type CandidatoDoScore, type ResultadoDoScore } from './matching.score';
import { triar } from './matching.triage';
import type {
  CandidatoAvaliado,
  DecisaoDeMatching,
  EventoParaMatching,
  FontesDeMatching,
  ResultadoDeEstagio,
  TituloExistente,
} from './matching.types';

const log = logger.child({ module: 'matching' });

/**
 * O motor do §7.2, em ordem. Cada estágio pode encerrar a decisão, e a decisão
 * sempre sai com rastro suficiente para virar um `MatchDecision`.
 *
 * Função pura em relação ao mundo: tudo que vem de fora chega pela porta
 * `FontesDeMatching`. É isso que deixa os quatro testes do §7.4 rodarem sem
 * banco e sem rede.
 */
export async function decidir(
  evento: EventoParaMatching,
  fontes: FontesDeMatching,
): Promise<DecisaoDeMatching> {
  const normalizado = normalizarTitulo(evento.title);
  const base = {
    normalizerVersion: normalizado.versaoDaConfig,
    normalizedQuery: normalizado.normalizado,
  };

  // ── Estágio 0: cache de decisão ────────────────────────────
  // Idempotência do sync: o mesmo evento visto três vezes por dia não
  // reconsulta o TMDB nem cria três pendências.
  const emCache = await fontes.buscarDecisaoEmCache(evento.ingressoEventId);
  if (emCache) {
    return {
      ...base,
      stage: 'cache',
      outcome: 'accepted',
      titleId: emCache.titleId,
      reason: 'Evento já tinha decisão registrada; reaproveitada sem consultar o TMDB.',
    };
  }

  // ── Estágio 1: triagem "isso é filme?" ─────────────────────
  const triagem = triar({
    title: evento.title,
    runtimeMinutes: evento.runtimeMinutes,
    distributor: evento.distributor,
  });

  if (triagem.provavelmenteNaoEhFilme) {
    return {
      ...base,
      stage: 'triage',
      outcome: 'not_a_film',
      triagem,
      reviewReason: 'probable_non_film',
      reason: `Triagem apontou evento, não filme (suspeita ${triagem.suspeita.toFixed(2)}): ${triagem.sinais
        .map((s) => s.sinal)
        .join(', ')}.`,
    };
  }

  // ── Estágio 2: match forte ─────────────────────────────────
  // Só faz sentido com título original: é o que o TMDB indexa bem.
  if (evento.originalTitle) {
    const forte = await tentarMatchForte(evento, fontes);
    if (forte) return { ...base, ...forte };
  }

  // ── Estágio 3: match fuzzy ─────────────────────────────────
  // Duas origens de candidato, e a ordem importa: primeiro o que JÁ existe no
  // catálogo (§7.3 — vários eventos do ingresso apontando para um Title), e só
  // depois o TMDB.
  const existentes = await fontes.buscarTitulosParecidos(normalizado.normalizado);
  const alvo = montarAlvo(evento, normalizado.normalizado, normalizado.semEspacos);

  const melhorExistente = escolherMelhor(
    existentes.map((t) => ({
      titulo: t,
      score: calcularScore(alvo, candidatoDeTituloExistente(t)),
    })),
  );

  const candidatosTmdb = await fontes.buscarCandidatosTmdb(normalizado.normalizado, evento.year);
  const melhorTmdb = escolherMelhor(
    candidatosTmdb.map((c) => ({ candidato: c, score: calcularScore(alvo, candidatoDeTmdb(c)) })),
  );

  // ── Estágio 4: limiares ────────────────────────────────────

  // Um Title já existente ganha do TMDB no empate: reaproveitar evita duplicata,
  // que é mais cara de desfazer do que de evitar (§7.3).
  if (melhorExistente && melhorExistente.score.total >= matchThresholds.auto) {
    return {
      ...base,
      stage: 'fuzzy',
      outcome: 'accepted',
      titleId: melhorExistente.titulo.id,
      ...(melhorExistente.titulo.tmdbId !== null ? { candidateTmdbId: melhorExistente.titulo.tmdbId } : {}),
      candidateLabel: melhorExistente.titulo.title,
      score: melhorExistente.score,
      reason: `Mesmo filme de um Title já no catálogo (score ${melhorExistente.score.total.toFixed(3)}); mais um id do ingresso apontando para ele.`,
    };
  }

  if (!melhorTmdb) {
    // nada no TMDB e nada parecido no catálogo
    if (melhorExistente && melhorExistente.score.total >= matchThresholds.review) {
      return {
        ...base,
        stage: 'threshold',
        outcome: 'review',
        titleId: melhorExistente.titulo.id,
        candidateLabel: melhorExistente.titulo.title,
        score: melhorExistente.score,
        reviewReason: 'possible_duplicate',
        reason: `Parecido com um Title existente, mas abaixo do limiar automático (${melhorExistente.score.total.toFixed(3)}).`,
      };
    }

    return {
      ...base,
      stage: 'threshold',
      outcome: 'no_candidate',
      reviewReason: 'no_candidate',
      reason: 'Nenhum candidato no TMDB nem no catálogo. Vira título órfão, visível no app.',
    };
  }

  const { candidato, score } = melhorTmdb;

  const suspeitoPeloGenero = triarComGeneros(evento, candidato, score);
  if (suspeitoPeloGenero) return { ...base, ...suspeitoPeloGenero };

  if (score.total >= matchThresholds.auto && temCorroboracao(score)) {
    return {
      ...base,
      stage: 'threshold',
      outcome: 'accepted',
      candidateTmdbId: candidato.tmdbId,
      candidateLabel: candidato.title,
      score,
      reason: `Score ${score.total.toFixed(3)} ≥ ${matchThresholds.auto}: aceito automaticamente.`,
    };
  }

  if (score.total >= matchThresholds.auto) {
    // score alto, mas o título é a ÚNICA evidência
    return {
      ...base,
      stage: 'threshold',
      outcome: 'review',
      candidateTmdbId: candidato.tmdbId,
      candidateLabel: candidato.title,
      score,
      reviewReason: 'low_confidence',
      reason: `Título bate (${score.total.toFixed(3)}), mas é a única evidência: sem ano, duração ou elenco para confirmar. Revisão humana.`,
    };
  }

  if (score.total >= matchThresholds.review) {
    return {
      ...base,
      stage: 'threshold',
      outcome: 'review',
      candidateTmdbId: candidato.tmdbId,
      candidateLabel: candidato.title,
      score,
      reviewReason: 'low_confidence',
      reason: `Score ${score.total.toFixed(3)} entre ${matchThresholds.review} e ${matchThresholds.auto}: revisão humana com candidato sugerido.`,
    };
  }

  log.debug('candidato abaixo do limiar de revisão', {
    evento: evento.ingressoEventId,
    score: score.total,
  });

  return {
    ...base,
    stage: 'threshold',
    outcome: 'orphan',
    candidateTmdbId: candidato.tmdbId,
    candidateLabel: candidato.title,
    score,
    reviewReason: 'low_confidence',
    reason: `Score ${score.total.toFixed(3)} abaixo de ${matchThresholds.review}: título órfão visível + revisão sem candidato confiável.`,
  };
}

/**
 * Repassa a triagem agora que os gêneros do TMDB estão na mão.
 *
 * ⚠️ Isto precisa rodar nos DOIS caminhos, o forte e o fuzzy. Quando só rodava
 * no fuzzy, `LINKIN PARK: UNSHATTER` era **aceito como filme**: tem título
 * original, ano e duração batendo, então o match forte encerrava a decisão
 * antes de alguém olhar os gêneros — que no TMDB são "Música, Documentário".
 * Distribuidora normal (Sato Company, que também lança anime de verdade) e 110
 * minutos: nenhum outro sinal o pegava.
 */
function triarComGeneros(
  evento: EventoParaMatching,
  candidato: CandidatoAvaliado,
  score: ResultadoDoScore,
): ResultadoDeEstagio | null {
  const triagem = triar({
    title: evento.title,
    runtimeMinutes: evento.runtimeMinutes,
    distributor: evento.distributor,
    tmdbGenres: candidato.genres,
  });

  if (!triagem.provavelmenteNaoEhFilme) return null;

  return {
    stage: 'triage',
    outcome: 'not_a_film',
    candidateTmdbId: candidato.tmdbId,
    candidateLabel: candidato.title,
    triagem,
    score,
    reviewReason: 'probable_non_film',
    reason: `Gêneros do TMDB confirmaram evento, não filme (${candidato.genres.join(', ')}).`,
  };
}

/**
 * Estágio 2 (§7.2): busca por título original + ano (±1) e **aceita só se o ano
 * bater exatamente e a duração divergir menos que a tolerância**.
 *
 * A janela de ±1 é da BUSCA, não da aceitação — é essa distinção que faz
 * *O Brutalista* (2024 no TMDB, 2025 no cartaz brasileiro) cair para o fuzzy e
 * terminar em revisão, como o §7.4 exige.
 */
async function tentarMatchForte(
  evento: EventoParaMatching,
  fontes: FontesDeMatching,
): Promise<ResultadoDeEstagio | null> {
  const original = normalizarTitulo(evento.originalTitle!);
  const candidatos = await fontes.buscarCandidatosTmdb(original.normalizado, evento.year);
  if (candidatos.length === 0) return null;

  const alvo = montarAlvo(evento, original.normalizado, original.semEspacos);

  for (const candidato of candidatos) {
    const anoBate =
      evento.year !== null && candidato.year !== null && evento.year === candidato.year;
    const duracaoBate =
      evento.runtimeMinutes === null ||
      candidato.runtimeMinutes === null ||
      Math.abs(evento.runtimeMinutes - candidato.runtimeMinutes) < matchTolerances.runtimeSlackMinutes;

    if (!anoBate || !duracaoBate) continue;

    const score = calcularScore(alvo, candidatoDeTmdb(candidato));
    // o título ainda precisa ser reconhecível; ano igual não basta
    if ((score.componentes.title?.valor ?? 0) < 0.6) continue;

    // o gênero do TMDB manda mesmo aqui: título, ano e duração batendo não
    // fazem de um show um filme
    const suspeito = triarComGeneros(evento, candidato, score);
    if (suspeito) return suspeito;

    return {
      stage: 'strong',
      outcome: 'accepted',
      candidateTmdbId: candidato.tmdbId,
      candidateLabel: candidato.title,
      score,
      reason: `Match forte: título original, ano ${candidato.year} exato e duração dentro de ${matchTolerances.runtimeSlackMinutes} min.`,
    };
  }

  return null;
}

function montarAlvo(
  evento: EventoParaMatching,
  normalizado: string,
  semEspacos: string,
): AlvoDoScore {
  return {
    normalizado,
    semEspacos,
    year: evento.year,
    runtimeMinutes: evento.runtimeMinutes,
    directorNames: evento.directorNames,
    castNames: evento.castNames,
  };
}

function candidatoDeTmdb(c: CandidatoAvaliado): CandidatoDoScore {
  const titulo = normalizarTitulo(c.title);
  const original = c.originalTitle ? normalizarTitulo(c.originalTitle) : null;

  return {
    normalizado: titulo.normalizado,
    semEspacos: titulo.semEspacos,
    normalizadoOriginal: original?.normalizado ?? null,
    year: c.year,
    releaseDate: c.releaseDate ?? null,
    yearBr: c.yearBr ?? null,
    releaseDateBr: c.releaseDateBr ?? null,
    runtimeMinutes: c.runtimeMinutes,
    directorNames: c.directorNames,
    castNames: c.castNames,
  };
}

function candidatoDeTituloExistente(t: TituloExistente): CandidatoDoScore {
  return {
    normalizado: t.normalizedTitle,
    semEspacos: t.normalizedTitle.replace(/\s/g, ''),
    normalizadoOriginal: t.normalizedOriginalTitle,
    year: t.year,
    runtimeMinutes: t.runtimeMinutes,
  };
}

/**
 * Aceitação automática exige mais que o título.
 *
 * Com ano e duração ausentes — o caso normal de filme que ainda não estreou —
 * o score passa a ser só a similaridade do título, e 1,0 em título é fácil
 * demais: dois filmes diferentes podem se chamar igual. Pelo menos um
 * componente de corroboração (duração, ano ou elenco) tem de entrar, senão a
 * decisão vai para revisão.
 */
function temCorroboracao(score: ResultadoDoScore): boolean {
  return Object.keys(score.componentes).length >= 2;
}

function escolherMelhor<T extends { score: ResultadoDoScore }>(lista: T[]): T | null {
  if (lista.length === 0) return null;
  return lista.reduce((melhor, atual) => (atual.score.total > melhor.score.total ? atual : melhor));
}
