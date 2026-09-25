import type { AvailabilityStatus, ReviewReason, TagFacet, UserTitleStatus } from '@prisma/client';
import type { SessoesPorCinema } from '../cinemas/cinemas.queries';

/** Quem marcou o filme — o círculo com a inicial no canto do pôster (§12). */
export interface MarcaDeUsuario {
  userId: string;
  inicial: string;
  acento: string;
}

/**
 * O PosterCard do §12, já pronto para desenhar. **Um só formato para todas as
 * trilhas, no mobile e no desktop** (§3, resolvido em 23/09/2026).
 */
export interface CardDeTitulo {
  id: string;
  titulo: string;
  posterUrl: string | null;
  ano: number | null;
  /** título sem metadata do TMDB: o card mostra o aviso de pendência (§2) */
  orfao: boolean;
  /** já formatadas em pt-BR: "8,5" e "92%". `null` quando a nota falta (§5.3). */
  imdb: string | null;
  rt: string | null;
  /** "Kinoplex · XD · DUB", ou "Estreia 15 out" quando ainda não há sessão */
  linha: string | null;
  marcadoPor: MarcaDeUsuario[];
  /** faixa colorida no rodapé do pôster: "Qui · 23h59", "Última semana" */
  faixa: string | null;
}

/** Uma trilha horizontal da home. `id` serve de âncora para a barra de navegação. */
export interface TrilhaDaHome {
  id: string;
  titulo: string;
  itens: CardDeTitulo[];
  /**
   * Quantos títulos a trilha tem NO TOTAL, antes do corte de apresentação.
   *
   * Sem isto a home não teria como saber que existe mais, e os filmes além do
   * corte sumiam sem deixar rastro — era a pendência 3 do README. É este número
   * que acende o "Ver todos".
   */
  total: number;
}

export interface HeroDaHome {
  id: string;
  titulo: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** "Filme • Ficção científica • IMAX • Legendado" — já na ordem do modelo */
  taxonomia: string[];
  marcadoPor: MarcaDeUsuario[];
}

export interface PerfilDoApp {
  id: string;
  nome: string;
  inicial: string;
  acento: string;
  acentoSecundario: string | null;
}

export interface Home {
  perfil: PerfilDoApp;
  hero: HeroDaHome | null;
  trilhas: TrilhaDaHome[];
  /**
   * Modo degradado (§8): quantas horas tem o dado mais novo. O frontend só
   * mostra o aviso quando `degradado` é true — a decisão do limite é do
   * backend, para as duas telas não divergirem.
   */
  dados: { idadeEmHoras: number | null; degradado: boolean };
}

export interface TituloDaLista extends CardDeTitulo {
  disponibilidade: AvailabilityStatus[];
}

export interface PessoaDoTitulo {
  nome: string;
  personagem: string | null;
}

export interface TagDoTitulo {
  id: string;
  facet: TagFacet;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
}

export interface EstadoDeUsuario {
  userId: string;
  inicial: string;
  acento: string;
  status: UserTitleStatus;
  desde: Date;
}

export interface DetalheDoTitulo {
  id: string;
  titulo: string;
  tituloOriginal: string | null;
  ano: number | null;
  duracaoMinutos: number | null;
  sinopse: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  orfao: boolean;
  /** por que este título ainda não tem metadata, quando for o caso */
  pendencia: { motivo: ReviewReason; desde: Date } | null;
  notas: { imdb: string | null; rt: string | null; atualizadasEm: Date | null };
  generos: string[];
  diretores: PessoaDoTitulo[];
  elenco: PessoaDoTitulo[];
  estudios: string[];
  tags: TagDoTitulo[];
  estados: EstadoDeUsuario[];
  disponibilidade: Array<{ status: AvailabilityStatus; desde: Date }>;
  /** sessões futuras agrupadas por cinema e sala (§10) */
  sessoes: SessoesPorCinema[];
  /**
   * Link para a página do filme no ingresso.com (§1) — o `movies[].siteURL` do
   * CONTRATO.md §4.3, guardado em `TitleExternalId.sourceUrl`.
   *
   * Continua nullable: título órfão que nunca casou com um evento do ingresso
   * não tem página lá, e um evento visto antes de 24/09/2026 só ganha a URL no
   * sync seguinte. O botão some quando é `null`, em vez de levar a lugar nenhum.
   */
  ingressoUrl: string | null;
}
