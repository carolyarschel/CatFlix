import type { Pessoa } from '@prisma/client';

/** Quem quer ver um filme, com o interesse de cada um. */
export interface QuemQuer {
  pessoa: Pessoa;
  /** 1–5, as estrelas de "Marque seu interesse"; null quando não marcou */
  interesse: number | null;
  adicionadoEm: Date;
}

/**
 * As trilhas da aba "Quero assistir" (cineon-expansao §8), nesta ordem.
 * `em_cartaz` vem primeiro: é o filme da lista que dá para ver hoje (§4.3).
 */
export type GrupoDaLista = 'em_cartaz' | 'estreia_em_breve' | 'ja_disponivel' | 'sem_data';

export interface ItemDaLista {
  titleId: string;
  titulo: string;
  posterUrl: string | null;
  ano: number | null;
  orfao: boolean;
  /** já formatadas: "8,5" e "92%" — para o mesmo card das trilhas */
  imdb: string | null;
  rt: string | null;
  /** `AAAA-MM-DD`: estreia no Brasil, ou a original quando não há a daqui */
  estreia: string | null;
  /** a estreia acima é a original (não há data do Brasil) */
  estreiaMundial: boolean;
  quem: QuemQuer[];
  grupo: GrupoDaLista;
}

export type EscopoDaLista = Pessoa | 'AMBOS';
