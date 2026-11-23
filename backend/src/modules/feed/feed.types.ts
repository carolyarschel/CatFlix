// =====================================================================
// Contrato de Feed v1 (seção 7 do contexto do CG). Cópia de CG Novo/backend/src/shared/contrato/feed-v1.ts.
// Toda fonte do ecossistema expõe:
//   GET /gatur-feed/v1/eventos?desde=<ISO-8601>&cursor=<opaco>&limite=<n>
// [ASSUMIDO] Por enquanto estes tipos são copiados em cada app.
// [PENDENTE] Virar um repositório `gatur-contratos`.
// Não altere estes tipos sem combinar com todas as fontes.
// =====================================================================

export const CAMINHO_FEED_EVENTOS_V1 = '/gatur-feed/v1/eventos';

export const PAPEIS = ['CAT', 'BEAR'] as const;
export type PapelFeed = (typeof PAPEIS)[number];

export const TIPOS_ITEM = ['MIDIA', 'MARCO'] as const;
export type TipoItemFeed = (typeof TIPOS_ITEM)[number];

export const FORMATOS = ['PONTO', 'INTERVALO'] as const;
export type FormatoFeed = (typeof FORMATOS)[number];

export const PRECISOES = ['DIA', 'MES', 'ANO'] as const;
export type PrecisaoFeed = (typeof PRECISOES)[number];

export const TIPOS_OBRA = ['FILME', 'SERIE', 'JOGO', 'LIVRO', 'MANHWA', 'OUTRO'] as const;
export type TipoObraFeed = (typeof TIPOS_OBRA)[number];

export const PROVEDORES_EXTERNOS = ['TMDB', 'IMDB', 'STEAM', 'IGDB', 'MAL', 'ISBN', 'OPENLIBRARY'] as const;
export type ProvedorExternoFeed = (typeof PROVEDORES_EXTERNOS)[number];

/** Categorias já combinadas com as fontes. Uma categoria desconhecida é aceita (cai em 'sem modelo'). */
export const CATEGORIAS_CONHECIDAS = [
  'jogo.comecou',
  'jogo.zerou',
  'jogo.platinou',
  'filme.cinema',
  'filme.casa',
  'leitura.comecou', // [PENDENTE] confirmar com o app de Livros
  'leitura.terminou', // [PENDENTE] confirmar com o app de Livros
  'manhwa.comecou', // [PENDENTE] confirmar com a Biblioteca
  'manhwa.terminou', // [PENDENTE] confirmar com a Biblioteca
  'viagem',
] as const;
export type CategoriaConhecida = (typeof CATEGORIAS_CONHECIDAS)[number];

export interface FeedResposta {
  itens: FeedItem[];
  /** `null` = acabou. */
  proximoCursor: string | null;
}

export interface FeedObra {
  tipo: TipoObraFeed;
  titulo: string;
  tituloOriginal?: string;
  ano?: number;
  capaUrl?: string;
  idsExternos: Partial<Record<ProvedorExternoFeed, string>>;
  totais?: { duracaoMin?: number; episodios?: number; paginas?: number; capitulos?: number };
  metadados?: Record<string, unknown>;
}

export interface FeedNota {
  papel: PapelFeed;
  valor: number;
  escalaMax: number;
  comentario?: string;
}

export interface FeedItem {
  /** Estável e único na fonte. */
  idNaFonte: string;
  tipo: TipoItemFeed;
  formato: FormatoFeed;
  /** Chave dos títulos automáticos (seção 6). */
  categoria?: string;
  /** Obrigatório se `tipo = MARCO`. */
  titulo?: string;
  obra?: FeedObra;
  /** ISO-8601. */
  inicio: string;
  precisaoInicio?: PrecisaoFeed;
  /** ISO-8601; `null` em INTERVALO = em andamento. */
  fim?: string | null;
  precisaoFim?: PrecisaoFeed;
  participantes: PapelFeed[];
  metricas?: { minutos?: number; episodios?: number; paginas?: number; capitulos?: number };
  notas?: FeedNota[];
  /** ISO-8601. Base do cursor. */
  atualizadoEm: string;
  /** Tombstone. */
  removido?: boolean;
}
