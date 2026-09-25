import type { AudioType, SessionKind } from '@prisma/client';

/**
 * Formas normalizadas que este módulo entrega.
 *
 * Note que NÃO há `titleId` nem `cinemaId` aqui: o módulo `ingresso` não
 * conhece o catálogo (§11 do contexto). Ele devolve ids do ingresso; quem
 * resolve para `Title` e `Cinema` é o `matching` e o `sync`.
 */

export interface CidadeNormalizada {
  ingressoId: string;
  name: string;
  uf: string | null;
  timezone: string | null;
  urlKey: string | null;
}

export interface CinemaNormalizado {
  ingressoId: string;
  name: string;
  chain: string | null;
  address: string | null;
  cityId: string | null;
  cityName: string | null;
  urlKey: string | null;
  totalRooms: number | null;
  enabled: boolean;
}

export interface SessaoNormalizada {
  ingressoSessionId: string;
  theaterIngressoId: string;
  /** id do evento no ingresso — entra no matching, não no catálogo direto */
  eventIngressoId: string;
  startsAt: Date;
  roomType: string;
  roomLabel: string | null;
  roomName: string | null;
  audio: AudioType;
  is3d: boolean;
  sessionKind: SessionKind;
  purchaseUrl: string | null;
  enabled: boolean;
}

/** Resultado de uma busca, com o rastro para auditoria e modo degradado. */
export interface RespostaIngresso<T> {
  dados: T;
  rawPayloadId: string;
  httpStatus: number;
  /** true quando o cinema não tem sessão nenhuma (204) — não é erro */
  vazio: boolean;
}
