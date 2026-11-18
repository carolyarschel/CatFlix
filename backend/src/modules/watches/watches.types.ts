import type { DatePrecision, Pessoa, WatchLocation } from '@prisma/client';

/** O que chega para registrar ou editar uma visualização. */
export interface DadosDaVisualizacao {
  /**
   * `AAAA-MM-DD`, `AAAA-MM` ou `AAAA`. A precisão sai do formato: "assistimos
   * em 2019" é uma resposta legítima para filme antigo (cineon-expansao §3.2).
   */
  data: string;
  local: WatchLocation;
  participantes: Pessoa[];
  cinemaId?: string | null;
  cinemaNomeLivre?: string | null;
  tipoSala?: string | null;
  observacao?: string | null;
}

export interface VisualizacaoDoTitulo {
  id: string;
  titleId: string;
  /** `AAAA-MM-DD`, `AAAA-MM` ou `AAAA`, conforme a precisão — o que foi dito */
  data: string;
  precisao: DatePrecision;
  local: WatchLocation;
  participantes: Pessoa[];
  cinemaId: string | null;
  /** nome do cinema da base, ou o nome livre */
  cinema: string | null;
  tipoSala: string | null;
  observacao: string | null;
  atualizadoEm: Date;
}

export interface VisualizacaoDaLista extends VisualizacaoDoTitulo {
  titulo: { id: string; titulo: string; posterUrl: string | null; ano: number | null };
}

export interface FiltrosDeVisualizacoes {
  /** `AMBOS` = só as que os dois viram juntos */
  pessoa?: Pessoa | 'AMBOS';
  local?: WatchLocation;
  /** ano em que assistiram */
  ano?: number;
  /** busca no título */
  q?: string;
  cursor?: string;
  limite?: number;
}
