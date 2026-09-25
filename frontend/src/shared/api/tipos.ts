/**
 * Formato das respostas do backend.
 *
 * Escrito à mão de propósito: é a fronteira entre os dois lados do projeto, e
 * um tipo gerado automaticamente esconderia uma mudança de contrato em vez de
 * quebrar o build. Quando um campo mudar no backend, o `npm run build` daqui
 * aponta o dedo.
 */

export type StatusDeDisponibilidade = 'em_cartaz' | 'pre_estreia' | 'em_breve';
export type StatusDeUsuario = 'quero_ver' | 'marcado' | 'visto';

export interface MarcaDeUsuario {
  userId: string;
  inicial: string;
  acento: string;
}

export interface CardDeTitulo {
  id: string;
  titulo: string;
  posterUrl: string | null;
  ano: number | null;
  /** sem metadata do TMDB ainda (§2): o card avisa, mas o filme aparece */
  orfao: boolean;
  /** já formatadas em pt-BR pelo backend: "8,5", "92%" */
  imdb: string | null;
  rt: string | null;
  /** "Kinoplex · XD · DUB" ou "Estreia 15 out" */
  linha: string | null;
  marcadoPor: MarcaDeUsuario[];
  /** faixa de urgência no rodapé do pôster: "Qui · 23h59", "Última semana" */
  faixa: string | null;
}

export interface TrilhaDaHome {
  id: string;
  titulo: string;
  itens: CardDeTitulo[];
  /**
   * Quantos títulos a trilha tem no total, antes do corte de 24 da home.
   * Maior que `itens.length` acende o "Ver todos".
   */
  total: number;
}

export interface HeroDaHome {
  id: string;
  titulo: string;
  posterUrl: string | null;
  backdropUrl: string | null;
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
  dados: { idadeEmHoras: number | null; degradado: boolean };
}

export interface ContagemDaRevisao {
  total: number;
}

// ── Fila de revisão (§10) ────────────────────────────────────

export type MotivoDeRevisao =
  | 'low_confidence'
  | 'no_candidate'
  | 'possible_duplicate'
  | 'probable_non_film';

export interface ItemDaFila {
  id: string;
  eventoTitulo: string;
  eventoMeta: string;
  candidatoTitulo: string | null;
  candidatoMeta: string | null;
  temCandidato: boolean;
  candidatoTmdbId: number | null;
  motivo: MotivoDeRevisao;
  score: number | null;
  criadoEm: string;
  subjectTitleId: string | null;
  posterUrl: string | null;
  /** o que o matcher escreveu ao parar aqui — é o que torna a fila revisável */
  explicacao: string | null;
}

export interface FilaDeRevisao {
  itens: ItemDaFila[];
  total: number;
  porMotivo: Array<{ motivo: MotivoDeRevisao; quantidade: number }>;
}

export interface CandidatoDoTmdb {
  tmdbId: number;
  titulo: string;
  tituloOriginal: string | null;
  ano: number | null;
  posterUrl: string | null;
}

// ── Painel de tags (§12) ─────────────────────────────────────

export type FacetaDeTag = 'sala' | 'cinema' | 'audio' | 'manual';

export interface ItemDeFaceta {
  /**
   * `sala:imax` — qualificado pela faceta, e é assim que vai no `?tag=` de
   * `GET /titles`. O slug sozinho não é único entre facetas: uma tag manual
   * "IMAX" (passo 11) casaria também com a sala IMAX e alargaria o filtro.
   */
  id: string;
  facet: FacetaDeTag;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
  /** quantos títulos têm esta tag — a contagem que aparece à direita do item */
  titulos: number;
}

export interface GrupoDeFacetas {
  facet: FacetaDeTag;
  /** "Sala", "Cinema", "Áudio", "Suas tags" — o rótulo vem pronto do backend */
  rotulo: string;
  itens: ItemDeFaceta[];
}

export interface Facetas {
  grupos: GrupoDeFacetas[];
  total: number;
}

export interface TituloDaLista extends CardDeTitulo {
  disponibilidade: StatusDeDisponibilidade[];
}

export interface ListaDeTitulos {
  itens: TituloDaLista[];
  total: number;
}

// ── Detalhe do filme (§1 e §10) ──────────────────────────────

export type TipoDeSessao = 'regular' | 'pre_estreia' | 'especial';
export type TipoDeAudio = 'dublado' | 'legendado' | 'original' | 'desconhecido';

export interface SessaoDoDia {
  id: string;
  inicio: string;
  /** "19h40", já no fuso da cidade — o backend é quem sabe o fuso */
  horario: string;
  /** "2026-09-24", no fuso da cidade; é a chave de agrupamento por dia */
  dia: string;
  /** rótulo do FORMATO ("IMAX", "XD"); `null` quando é sala comum */
  sala: string | null;
  /** nome da sala no cinema ("Sala 5 JR") */
  salaNome: string | null;
  audio: TipoDeAudio;
  audioRotulo: string | null;
  is3d: boolean;
  /**
   * ⚠️ Não renderizar. `sessionKind` vem de `inPreSale`, que no ingresso é
   * pré-venda e não pré-estreia — ver a pendência 1 do README. Está no tipo
   * porque o backend manda; mostrar seria carimbar "Pré-estreia" em sessão de
   * filme que já estreou.
   */
  tipo: TipoDeSessao;
  urlCompra: string | null;
}

export interface SessoesPorCinema {
  cinemaId: string;
  cinema: string;
  rede: string | null;
  sessoes: SessaoDoDia[];
}

export interface PessoaDoTitulo {
  nome: string;
  personagem: string | null;
}

export interface TagDoTitulo {
  id: string;
  facet: FacetaDeTag;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
}

export interface EstadoDeUsuario {
  userId: string;
  inicial: string;
  acento: string;
  status: StatusDeUsuario;
  desde: string;
}

export type MotivoDePendencia = MotivoDeRevisao;

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
  /** por que este título ainda não tem metadata, quando for o caso (§2) */
  pendencia: { motivo: MotivoDePendencia; desde: string } | null;
  notas: { imdb: string | null; rt: string | null; atualizadasEm: string | null };
  generos: string[];
  diretores: PessoaDoTitulo[];
  elenco: PessoaDoTitulo[];
  estudios: string[];
  tags: TagDoTitulo[];
  estados: EstadoDeUsuario[];
  disponibilidade: Array<{ status: StatusDeDisponibilidade; desde: string }>;
  sessoes: SessoesPorCinema[];
  /** página do filme no ingresso.com; `null` some com o botão (§1) */
  ingressoUrl: string | null;
}
