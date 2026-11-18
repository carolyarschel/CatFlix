import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { TmdbClient, normalizarCandidato } from '../tmdb';
import type { ResultadoDaBusca } from './library.types';

const log = logger.child({ module: 'library' });

/**
 * Busca do botão "+" (cineon-expansao §4.1): pôster, título, ano e diretor de
 * cada resultado, e se o filme já está no catálogo.
 *
 * **O diretor custa caro.** A busca do TMDB não traz créditos; seria um pedido
 * a mais por resultado, a cada busca (com debounce, ainda são várias por
 * filme procurado). Três camadas, da mais barata para a mais cara:
 *
 * 1. filme que já está no catálogo → diretor do banco, sem rede;
 * 2. cache de processo, porque a mesma busca se repete enquanto a pessoa digita;
 * 3. o TMDB, e só para os primeiros resultados — quem procura "Duna" escolhe
 *    entre os de cima, não entre o 18º e o 19º.
 *
 * Falhar ao buscar um diretor não derruba a busca: o resultado sai sem diretor.
 */

const RESULTADOS = 10;
const DIRETORES_PELA_REDE = 6;
const VALIDADE_DO_CACHE_MS = 7 * 24 * 3_600_000;
const TAMANHO_DO_CACHE = 1_000;

const cacheDeDiretores = new Map<number, { diretores: string[]; em: number }>();

function doCache(tmdbId: number): string[] | null {
  const item = cacheDeDiretores.get(tmdbId);
  if (!item) return null;
  if (Date.now() - item.em > VALIDADE_DO_CACHE_MS) {
    cacheDeDiretores.delete(tmdbId);
    return null;
  }
  return item.diretores;
}

function guardar(tmdbId: number, diretores: string[]): void {
  // Map guarda a ordem de inserção: o primeiro é o mais antigo
  if (cacheDeDiretores.size >= TAMANHO_DO_CACHE) {
    const maisAntigo = cacheDeDiretores.keys().next().value;
    if (maisAntigo !== undefined) cacheDeDiretores.delete(maisAntigo);
  }
  cacheDeDiretores.set(tmdbId, { diretores, em: Date.now() });
}

export async function buscarParaAdicionar(
  q: string,
  tmdb: TmdbClient = new TmdbClient(),
): Promise<ResultadoDaBusca[]> {
  const { dados } = await tmdb.buscarFilmes(q);
  const candidatos = dados.results.slice(0, RESULTADOS).map(normalizarCandidato);
  if (candidatos.length === 0) return [];

  // quais já estão no catálogo, e o diretor deles direto do banco
  const noCatalogo = await prisma.titleExternalId.findMany({
    where: { source: 'tmdb', externalId: { in: candidatos.map((c) => String(c.tmdbId)) } },
    select: {
      externalId: true,
      title: {
        select: {
          id: true,
          credits: {
            where: { role: 'director' },
            select: { person: { select: { name: true } } },
          },
        },
      },
    },
  });
  const porTmdb = new Map(noCatalogo.map((n) => [Number(n.externalId), n.title]));

  const diretores = new Map<number, string[]>();
  for (const c of candidatos) {
    const doBanco = porTmdb.get(c.tmdbId)?.credits.map((cr) => cr.person.name);
    if (doBanco && doBanco.length > 0) diretores.set(c.tmdbId, doBanco);
    else {
      const guardados = doCache(c.tmdbId);
      if (guardados) diretores.set(c.tmdbId, guardados);
    }
  }

  const faltando = candidatos
    .slice(0, DIRETORES_PELA_REDE)
    .filter((c) => !diretores.has(c.tmdbId));

  // o HttpClient já limita a concorrência (§5.1: no máximo 4 em paralelo)
  await Promise.all(
    faltando.map(async (c) => {
      try {
        const nomes = await tmdb.buscarDiretores(c.tmdbId);
        guardar(c.tmdbId, nomes);
        diretores.set(c.tmdbId, nomes);
      } catch (erro) {
        log.warn('diretor não veio para um resultado da busca', { tmdbId: c.tmdbId, erro });
      }
    }),
  );

  return candidatos.map((c) => ({
    tmdbId: c.tmdbId,
    titulo: c.title,
    tituloOriginal: c.originalTitle && c.originalTitle !== c.title ? c.originalTitle : null,
    ano: c.year,
    posterUrl: c.posterUrl,
    diretores: diretores.get(c.tmdbId) ?? [],
    titleId: porTmdb.get(c.tmdbId)?.id ?? null,
  }));
}

/** Só para os testes. */
export function limparCacheDeDiretores(): void {
  cacheDeDiretores.clear();
}
