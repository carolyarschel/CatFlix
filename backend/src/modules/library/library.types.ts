import type { Pessoa } from '@prisma/client';
import type { DetalheDoTitulo, PessoaDoTitulo } from '../catalog/catalog.types';
import type { VisualizacaoDoTitulo } from '../watches/watches.types';

/** Um resultado da busca do "+" (cineon-expansao §4.1). */
export interface ResultadoDaBusca {
  tmdbId: number;
  titulo: string;
  /** só quando difere do título em português */
  tituloOriginal: string | null;
  ano: number | null;
  posterUrl: string | null;
  /** pode vir vazio: filme não lançado, ou o pedido dos créditos falhou */
  diretores: string[];
  /** o filme já está no catálogo (entrou pelo cinema ou pelo "+") */
  titleId: string | null;
}

export interface GrupoDeProvedores {
  tipo: 'flatrate' | 'free' | 'ads' | 'rent' | 'buy';
  /** "Assinatura", "Grátis", "Com anúncios", "Aluguel", "Compra" */
  rotulo: string;
  itens: Array<{ id: number; nome: string; logoUrl: string | null }>;
}

/** O que cada pessoa tem com o filme. Tudo derivado, nada gravado como status (§3.3). */
export interface SituacaoDaPessoa {
  pessoa: Pessoa;
  assistiu: boolean;
  querAssistir: boolean;
  /** 1–5, quando está na lista */
  interesse: number | null;
  nota: number | null;
  /** só dá nota quem participou de alguma visualização */
  podeDarNota: boolean;
  /** o comentário dela sobre o filme; comentar não exige ter assistido */
  comentario: string | null;
}

/**
 * O detalhe do filme da expansão (§7): tudo o que o detalhe do catálogo já
 * tinha, mais o acervo do casal.
 */
export interface DetalheDoAcervo extends Omit<DetalheDoTitulo, 'elenco'> {
  /** os 10 primeiros do elenco, com foto e personagem (§5.1) */
  elenco: PessoaDoTitulo[];
  /** idioma da sinopse: "pt-BR", ou o de reserva ("en-US") — o selo do §5.2 */
  sinopseIdioma: string | null;
  /** `AAAA-MM-DD`; `mundial` quando não há data do Brasil ("Estreia (mundial)") */
  estreia: { data: string; mundial: boolean } | null;
  statusProducao: string | null;
  justwatchUrl: string | null;
  /**
   * Para onde o botão "Onde assistir" leva (§6): o `justwatchUrl` salvo, ou a
   * busca do JustWatch pelo título quando ainda não há link.
   */
  ondeAssistirUrl: string;
  /**
   * Onde o filme está disponível no Brasil (§6), agrupado por tipo — assinatura,
   * grátis, com anúncios, aluguel, compra. Dado do JustWatch: a tela atribui.
   * Vazio quando o TMDB não conhece serviço nenhum (ou ainda não foi lido).
   */
  provedores: GrupoDeProvedores[];
  /** em cartaz ou em pré-estreia: a tela mostra o bloco de sessões (§7.12) */
  emCartaz: boolean;
  /** quem está logado */
  eu: Pessoa;
  pessoas: SituacaoDaPessoa[];
  visualizacoes: VisualizacaoDoTitulo[];
}
