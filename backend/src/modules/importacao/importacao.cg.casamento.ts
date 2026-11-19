import { logger } from '../../shared/logger';
// arquivo puro do matching, não o barril (que puxa TMDB e banco)
import { normalizarTitulo } from '../matching/matching.normalizer';
import { normalizarCandidato, type TmdbClient } from '../tmdb';
import type { FilmeDoCg } from './importacao.cg.leitura';

const log = logger.child({ module: 'importacao' });

/**
 * Qual filme do TMDB é este filme do CG (cineon-expansao §11).
 *
 * Quase nada no CG tem `tmdb_id` (17 de 181), então o filme é buscado pelo
 * título e conferido com o que o CG guarda: ano de lançamento e diretor. A
 * regra do projeto vale aqui também (§2): **nenhum casamento duvidoso entra
 * em silêncio**. O que não fechar vai para a fila Revisar, com o candidato e o
 * motivo escritos.
 */

export interface CandidatoDaBusca {
  tmdbId: number;
  titulo: string;
  tituloOriginal: string | null;
  ano: number | null;
}

export type Casamento =
  | { tipo: 'certo'; tmdbId: number; como: string }
  | { tipo: 'duvida'; candidato: CandidatoDaBusca; motivo: string }
  | { tipo: 'sem_candidato'; motivo: string };

const normal = (t: string | null | undefined) => (t ? normalizarTitulo(t).normalizado : '');

/** "Steven Spielberg" casa com "Spielberg, Steven"? Não precisa: nomes do CG vieram do próprio TMDB. */
function mesmoDiretor(doCg: string, doTmdb: string[]): boolean {
  const alvo = normal(doCg);
  return doTmdb.some((d) => {
    const n = normal(d);
    return n === alvo || n.includes(alvo) || alvo.includes(n);
  });
}

function rotulo(c: CandidatoDaBusca): string {
  return `${c.titulo}${c.ano ? ` (${c.ano})` : ''}`;
}

/**
 * A decisão, sem rede: recebe os candidatos da busca e uma função que diz os
 * diretores de um candidato (para os testes, uma tabela; na vida real, o TMDB).
 *
 * Certo quando:
 * - o título (ou o original) é igual depois de normalizado, e
 * - o ano bate com o lançamento do CG com tolerância de 1 (o CG guarda a
 *   estreia daqui; o TMDB, a original), e
 * - o diretor bate — ou o CG não tem diretor e só há um candidato assim, no
 *   ano exato.
 */
export async function decidirCasamento(
  filme: Pick<FilmeDoCg, 'titulo' | 'lancamento' | 'diretor' | 'tmdbId'>,
  candidatos: CandidatoDaBusca[],
  diretoresDe: (tmdbId: number) => Promise<string[]>,
): Promise<Casamento> {
  if (filme.tmdbId) return { tipo: 'certo', tmdbId: filme.tmdbId, como: 'tmdb_id guardado no CG' };

  if (candidatos.length === 0) {
    return { tipo: 'sem_candidato', motivo: 'O TMDB não achou nada com este título.' };
  }

  const ano = filme.lancamento ? Number(filme.lancamento.slice(0, 4)) : null;
  const titulo = normal(filme.titulo);

  const mesmoTitulo = candidatos.filter(
    (c) => normal(c.titulo) === titulo || normal(c.tituloOriginal) === titulo,
  );
  const noAno = mesmoTitulo.filter((c) => ano === null || (c.ano !== null && Math.abs(c.ano - ano) <= 1));

  if (noAno.length === 0) {
    const melhor = mesmoTitulo[0] ?? candidatos[0]!;
    return {
      tipo: 'duvida',
      candidato: melhor,
      motivo:
        mesmoTitulo.length > 0
          ? `Mesmo título, mas o ano não bate: o CG diz ${ano ?? 'sem ano'}, o TMDB ${melhor.ano ?? 'sem ano'}.`
          : `Nenhum resultado do TMDB tem exatamente este título; o mais próximo é "${rotulo(melhor)}".`,
    };
  }

  if (filme.diretor) {
    // só os primeiros três: além disso é ruído, e cada um custa um pedido
    const conferidos: CandidatoDaBusca[] = [];
    for (const c of noAno.slice(0, 3)) {
      if (mesmoDiretor(filme.diretor, await diretoresDe(c.tmdbId))) conferidos.push(c);
    }
    if (conferidos.length === 1) {
      return { tipo: 'certo', tmdbId: conferidos[0]!.tmdbId, como: 'título, ano e diretor' };
    }
    return {
      tipo: 'duvida',
      candidato: conferidos[0] ?? noAno[0]!,
      motivo:
        conferidos.length > 1
          ? `Mais de um filme do TMDB com o mesmo título, ano e diretor.`
          : `Título e ano batem, mas o diretor não: o CG diz "${filme.diretor}".`,
    };
  }

  const exatos = noAno.filter((c) => c.ano === ano);
  if (exatos.length === 1 && noAno.length === 1) {
    return { tipo: 'certo', tmdbId: exatos[0]!.tmdbId, como: 'título e ano (o CG não tem diretor)' };
  }
  return {
    tipo: 'duvida',
    candidato: exatos[0] ?? noAno[0]!,
    motivo: 'O CG não tem diretor para conferir, e o título e o ano não bastam para ter certeza.',
  };
}

/** Busca no TMDB e decide. Com ano primeiro; sem resultado, sem ano. */
export async function casarComTmdb(filme: FilmeDoCg, tmdb: TmdbClient): Promise<Casamento> {
  if (filme.tmdbId) return decidirCasamento(filme, [], async () => []);

  const ano = filme.lancamento ? Number(filme.lancamento.slice(0, 4)) : null;
  let resultados = (await tmdb.buscarFilmes(filme.titulo, { ano })).dados.results;
  if (resultados.length === 0 && ano) resultados = (await tmdb.buscarFilmes(filme.titulo)).dados.results;

  const candidatos = resultados.slice(0, 10).map((r) => {
    const c = normalizarCandidato(r);
    return { tmdbId: c.tmdbId, titulo: c.title, tituloOriginal: c.originalTitle, ano: c.year };
  });

  return decidirCasamento(filme, candidatos, async (tmdbId) => {
    try {
      return await tmdb.buscarDiretores(tmdbId);
    } catch (erro) {
      log.warn('diretor não veio do TMDB', { tmdbId, erro });
      return [];
    }
  });
}
