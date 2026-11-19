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
  /** "CatFlix" / "HBUrso" */
  nome: string;
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
  | 'probable_non_film'
  | 'import_low_confidence';

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
  /** "ingresso", "importacao_cg" ou "manual" */
  origem: string;
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
  /** foto do TMDB; sem foto, a tela mostra as iniciais */
  fotoUrl: string | null;
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

// ── Programação do dia ───────────────────────────────────────

/** Um filme num dia: o que passa, onde e a que horas. */
export interface FilmeDoDia {
  id: string;
  titulo: string;
  posterUrl: string | null;
  ano: number | null;
  orfao: boolean;
  imdb: string | null;
  rt: string | null;
  duracaoMinutos: number | null;
  generos: string[];
  marcadoPor: MarcaDeUsuario[];
  /** só as sessões DESTE dia, agrupadas por cinema */
  sessoes: SessoesPorCinema[];
  totalDeSessoes: number;
}

export interface DiaComSessao {
  /** `AAAA-MM-DD`, no fuso da cidade */
  dia: string;
  filmes: number;
}

export interface ProgramacaoDoDia {
  dia: string;
  /** "hoje" segundo o fuso da cidade, não o relógio do aparelho */
  hoje: string;
  /** os dias com grade publicada, de hoje em diante — é o seletor de data */
  dias: DiaComSessao[];
  cinemas: Array<{ id: string; nome: string; rede: string | null }>;
  filmes: FilmeDoDia[];
  totalDeSessoes: number;
  dados: { idadeEmHoras: number | null; degradado: boolean };
}

// ── Acervo do casal (cineon-expansao) ────────────────────────

/** As duas pessoas, como o ecossistema Gatur as chama. */
export type Pessoa = 'CAT' | 'BEAR';

/** Um resultado da busca do "+" (`GET /tmdb/search`). */
export interface ResultadoDaBusca {
  tmdbId: number;
  titulo: string;
  /** só quando difere do título em português */
  tituloOriginal: string | null;
  ano: number | null;
  posterUrl: string | null;
  /** pode vir vazio: filme não lançado, ou o TMDB não respondeu a tempo */
  diretores: string[];
  /** o filme já está no catálogo (entrou pelo cinema ou pelo "+") */
  titleId: string | null;
}

export interface CinemaDaLista {
  id: string;
  ingressoId: string;
  nome: string;
  rede: string | null;
}

export type LocalDaVisualizacao = 'CASA' | 'CINEMA';
export type PrecisaoDaData = 'DIA' | 'MES' | 'ANO';

/** O corpo de `POST /titles/:id/watches`. */
export interface DadosDaVisualizacao {
  /** `AAAA-MM-DD`, `AAAA-MM` ou `AAAA`: a precisão sai do formato */
  data: string;
  local: LocalDaVisualizacao;
  participantes: Pessoa[];
  cinemaId?: string | null;
  cinemaNomeLivre?: string | null;
  tipoSala?: string | null;
  observacao?: string | null;
}

export interface VisualizacaoDoTitulo {
  id: string;
  titleId: string;
  data: string;
  precisao: PrecisaoDaData;
  local: LocalDaVisualizacao;
  participantes: Pessoa[];
  cinemaId: string | null;
  /** nome do cinema da base, ou o nome livre */
  cinema: string | null;
  tipoSala: string | null;
  observacao: string | null;
  atualizadoEm: string;
}

export interface RespostaDaVisualizacao {
  visualizacao: VisualizacaoDoTitulo;
  /** linhas que saíram da lista "quero assistir" — o que o "Desfazer" devolve */
  removidosDaLista: Array<{ id: string; pessoa: Pessoa }>;
}

export interface GrupoDeProvedores {
  tipo: 'flatrate' | 'free' | 'ads' | 'rent' | 'buy';
  /** "Assinatura", "Grátis", "Com anúncios", "Aluguel", "Compra" */
  rotulo: string;
  itens: Array<{ id: number; nome: string; logoUrl: string | null }>;
}

/** O que cada pessoa tem com o filme — tudo calculado no backend, nada gravado. */
export interface SituacaoDaPessoa {
  pessoa: Pessoa;
  assistiu: boolean;
  querAssistir: boolean;
  /** 1–5, quando está na lista */
  interesse: number | null;
  nota: number | null;
  /** só dá nota quem participou de alguma visualização */
  podeDarNota: boolean;
}

/** `GET /library/titles/:id` — o detalhe do filme da expansão (§7). */
export interface DetalheDoAcervo extends DetalheDoTitulo {
  /** idioma da sinopse: "pt-BR", ou o de reserva ("en-US") */
  sinopseIdioma: string | null;
  /** `AAAA-MM-DD`; `mundial` quando não há data do Brasil */
  estreia: { data: string; mundial: boolean } | null;
  /** Released, Post Production, Planned… */
  statusProducao: string | null;
  justwatchUrl: string | null;
  /** o link salvo do JustWatch, ou a busca dele pelo título */
  ondeAssistirUrl: string;
  /** onde está disponível no Brasil, por tipo — dado do JustWatch */
  provedores: GrupoDeProvedores[];
  /** em cartaz ou em pré-estreia: mostra o bloco de sessões */
  emCartaz: boolean;
  eu: Pessoa;
  pessoas: SituacaoDaPessoa[];
  visualizacoes: VisualizacaoDoTitulo[];
}

/** Um card da aba "Assistidos": o mesmo card das trilhas, com a última vez. */
export interface CardDoAssistido extends CardDeTitulo {
  ultimaVez: { data: string; precisao: PrecisaoDaData };
  vezes: number;
  notas: Array<{ pessoa: Pessoa; nota: number }>;
}

/** `GET /assistidos` */
export interface Assistidos {
  itens: CardDoAssistido[];
  total: number;
  proximaPagina: number | null;
  facetas: { anos: number[]; generos: string[] };
}

export type GrupoDaLista = 'em_cartaz' | 'estreia_em_breve' | 'ja_disponivel' | 'sem_data';

export interface ItemDaLista {
  titleId: string;
  titulo: string;
  posterUrl: string | null;
  ano: number | null;
  orfao: boolean;
  imdb: string | null;
  rt: string | null;
  /** `AAAA-MM-DD`: do Brasil, ou a original quando não há a daqui */
  estreia: string | null;
  estreiaMundial: boolean;
  quem: Array<{ pessoa: Pessoa; interesse: number | null; adicionadoEm: string }>;
  grupo: GrupoDaLista;
}

/** `GET /watchlist` */
export interface ListaQueroAssistir {
  grupos: Array<{ id: GrupoDaLista; titulo: string; itens: ItemDaLista[] }>;
  total: number;
}

// ── Importação do Crônicas de Gatur (cineon-expansao §11) ────

export type FaseDaImportacao = 'casando' | 'pronto' | 'aplicando' | 'aplicado' | 'erro';

export interface RelatorioDaImportacao {
  totais: {
    filmes: number;
    certos: number;
    duvidas: number;
    semCandidato: number;
    visualizacoes: number;
    lista: number;
    notas: number;
    favoritos: number;
    jaImportados: number;
  };
  revisao: Array<{
    titulo: string;
    lancamento: string | null;
    diretor: string | null;
    candidato: { titulo: string; ano: number | null; tmdbId: number } | null;
    motivo: string;
  }>;
  repetidos: Array<{ titulo: string; tmdbId: number; itens: string[] }>;
  avisos: Array<{ titulo: string; avisos: string[] }>;
  certos: Array<{ titulo: string; tmdbId: number; como: string; resumo: string }>;
}

/** `GET /importacao/cg/:id` */
export interface EstadoDaImportacao {
  id: string;
  fase: FaseDaImportacao;
  feitos: number;
  total: number;
  criadaEm: string;
  por: string;
  relatorio: RelatorioDaImportacao | null;
  erro: string | null;
}
