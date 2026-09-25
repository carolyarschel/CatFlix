import { TmdbClient, normalizarMetadata } from '../tmdb';
import type { MetadataNormalizada } from '../tmdb';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { CandidatoAvaliado, FontesDeMatching, TituloExistente } from './matching.types';

const log = logger.child({ module: 'matching:fontes' });

/** Quantos candidatos do TMDB abrimos em detalhe. Cada um é uma requisição. */
const CANDIDATOS_DETALHADOS = 3;

/** Quantos Titles parecidos o trigrama devolve para pontuação. */
const TITULOS_PARECIDOS = 10;

/**
 * Implementação real da porta `FontesDeMatching`: Postgres para o catálogo,
 * TmdbClient para os candidatos.
 *
 * A separação entre esta classe e o motor é o que permite os quatro testes do
 * §7.4 rodarem sem banco e sem rede.
 */
export class FontesDeProducao implements FontesDeMatching {
  private readonly tmdb: TmdbClient;
  /** memória de uma execução: o mesmo filme aparece em vários cinemas */
  private readonly cacheDeBusca = new Map<string, CandidatoAvaliado[]>();
  /**
   * Metadata completa dos candidatos já abertos em detalhe.
   *
   * O matching abre o candidato para pontuar (duração, crédito, gênero) e o
   * catálogo precisa da MESMA metadata para montar o `Title`. Sem guardar
   * aqui, o sync buscaria o mesmo filme duas vezes no TMDB.
   */
  private readonly cacheDeMetadata = new Map<number, MetadataNormalizada>();

  constructor(opcoes: { syncRunId?: string } = {}) {
    this.tmdb = new TmdbClient(opcoes.syncRunId ? { syncRunId: opcoes.syncRunId } : {});
  }

  /**
   * Estágio 0 (§7.2): o id do evento já tem `TitleExternalId`?
   * É o que torna o sync idempotente — três execuções por dia não refazem
   * trabalho nem criam três pendências do mesmo filme.
   */
  async buscarDecisaoEmCache(ingressoEventId: string): Promise<{ titleId: string } | null> {
    const existente = await prisma.titleExternalId.findUnique({
      where: { source_externalId: { source: 'ingresso', externalId: ingressoEventId } },
      select: { titleId: true },
    });

    return existente ? { titleId: existente.titleId } : null;
  }

  /**
   * Estágio 3, primeira origem: Titles que já existem e se parecem.
   *
   * Usa o operador `%` do pg_trgm, que passa pelo índice GIN
   * `titles_normalized_title_idx`. É isto que faz o caso 4 do §7.4 funcionar
   * sem varrer a tabela inteira.
   */
  async buscarTitulosParecidos(normalizado: string): Promise<TituloExistente[]> {
    if (!normalizado) return [];

    return prisma.$queryRaw<TituloExistente[]>`
      SELECT
        t.id,
        t.title,
        t.normalized_title          AS "normalizedTitle",
        t.normalized_original_title AS "normalizedOriginalTitle",
        t.year,
        t.runtime_minutes           AS "runtimeMinutes",
        e.external_id::int          AS "tmdbId"
      FROM titles t
      LEFT JOIN title_external_ids e
        ON e.title_id = t.id AND e.source = 'tmdb'
      WHERE t.status <> 'not_a_film'
        AND (t.normalized_title % ${normalizado}
             OR t.normalized_original_title % ${normalizado})
      ORDER BY similarity(t.normalized_title, ${normalizado}) DESC
      LIMIT ${TITULOS_PARECIDOS}
    `;
  }

  /**
   * Estágios 2 e 3, segunda origem: TMDB.
   *
   * A busca devolve pouco (sem duração, sem gênero, sem crédito), então
   * abrimos em detalhe os primeiros candidatos — é o detalhe que dá os
   * componentes de duração e crédito do score, e os gêneros que a triagem usa.
   */
  async buscarCandidatosTmdb(query: string, ano: number | null): Promise<CandidatoAvaliado[]> {
    if (!query) return [];

    const chave = `${query}|${ano ?? ''}`;
    const memorizado = this.cacheDeBusca.get(chave);
    if (memorizado) return memorizado;

    // O ano entra como FILTRO na busca, e filtro é binário: se o ingresso diz
    // 2026 e o TMDB diz 2025, o filme simplesmente some. Medido: "Always
    // Lalisa", "Queen Budapest" e "A Maravilhosa Árvore Encantada" voltavam
    // zero com o ano e um resultado sem ele.
    //
    // Então o ano é uma PREFERÊNCIA, não um requisito: tenta com, e se não
    // vier nada, tenta sem. O ano continua pesando no score, que é onde ele
    // deve pesar.
    let busca = await this.tmdb.buscarFilmes(query, { ano });

    if (busca.dados.total_results === 0 && ano !== null) {
      log.debug('busca com ano não achou nada; repetindo sem o filtro', { query, ano });
      busca = await this.tmdb.buscarFilmes(query, {});
    }

    if (busca.dados.total_results === 0) {
      this.cacheDeBusca.set(chave, []);
      return [];
    }

    const candidatos: CandidatoAvaliado[] = [];

    for (const resultado of busca.dados.results.slice(0, CANDIDATOS_DETALHADOS)) {
      try {
        const detalhe = await this.tmdb.buscarFilme(resultado.id);
        const meta = normalizarMetadata(detalhe.dados);
        this.cacheDeMetadata.set(meta.tmdbId, meta);

        candidatos.push({
          tmdbId: meta.tmdbId,
          title: meta.title,
          originalTitle: meta.originalTitle,
          year: meta.year,
          releaseDate: meta.releaseDate,
          yearBr: meta.yearBr,
          releaseDateBr: meta.releaseDateBr,
          runtimeMinutes: meta.runtimeMinutes,
          genres: meta.genres.map((g) => g.name),
          directorNames: meta.credits.filter((c) => c.role === 'director').map((c) => c.name),
          castNames: meta.credits.filter((c) => c.role === 'cast').map((c) => c.name),
        });
      } catch (erro) {
        // um detalhe que falhou não pode derrubar o matching do evento inteiro:
        // seguimos com os candidatos que deram certo
        log.warn('falha ao abrir candidato do TMDB em detalhe', { tmdbId: resultado.id, erro });
      }
    }

    this.cacheDeBusca.set(chave, candidatos);
    return candidatos;
  }

  /**
   * Metadata de um candidato que já foi aberto em detalhe nesta execução.
   * É o que o `catalog` usa para montar o `Title` sem uma segunda ida ao TMDB.
   */
  metadataDoCandidato(tmdbId: number): MetadataNormalizada | undefined {
    return this.cacheDeMetadata.get(tmdbId);
  }
}
