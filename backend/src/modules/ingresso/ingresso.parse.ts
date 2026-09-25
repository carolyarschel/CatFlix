import type { AudioType } from '@prisma/client';
import roomConfig from '../../config/room-types.json';
import type { RawSession, RawSessionType, RawShowtimeDay, RawTheater } from './ingresso.schemas';
import type { CinemaNormalizado, SessaoNormalizada } from './ingresso.types';

/**
 * Transforma o payload validado em algo que o catálogo entende.
 * Nada aqui fala com o banco nem com outro módulo — é função pura, testável
 * com fixture real.
 */

const AUDIO_POR_NOME = roomConfig.audioByName as Record<string, AudioType>;
const IGNORADOS = new Set(roomConfig.formatosIgnorados);
const TRIDIMENSIONAL = new Set(roomConfig.tridimensional);
const PRIORIDADE = roomConfig.prioridade;

/** minúsculas, sem acento, sem pontuação — vira chave estável de comparação */
export function slugificar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Separa áudio de formato de sala pela regra ESTRUTURAL do CONTRATO.md §6:
 * `id === 0` é tipo de cópia (áudio), `id > 0` é formato de sala (máscara de
 * bits). Não depende de casar nome nenhum, então um formato novo do ingresso
 * é classificado certo no primeiro sync, sem editar configuração.
 */
export function classificarTipos(types: RawSessionType[] | null | undefined): {
  audio: AudioType;
  roomType: string;
  roomLabel: string | null;
  is3d: boolean;
} {
  const lista = types ?? [];

  const nomesDeAudio = lista.filter((t) => t.id === 0).map((t) => t.name);
  const formatos = lista.filter((t) => t.id > 0).map((t) => t.name);

  // áudio: o primeiro nome reconhecido vence; nenhum reconhecido → desconhecido
  let audio: AudioType = 'desconhecido';
  for (const nome of nomesDeAudio) {
    const encontrado = AUDIO_POR_NOME[slugificar(nome)];
    if (encontrado) {
      audio = encontrado;
      break;
    }
  }

  const slugs = formatos.map(slugificar);
  const is3d = slugs.some((s) => TRIDIMENSIONAL.has(s));

  const candidatos = slugs.filter((s) => !IGNORADOS.has(s) && !TRIDIMENSIONAL.has(s));

  // o primeiro da lista de prioridade que aparecer; um formato desconhecido
  // ainda assim vira roomType, em vez de virar "normal" e sumir das tags
  const roomType =
    PRIORIDADE.find((p) => candidatos.includes(p)) ?? candidatos[0] ?? 'normal';

  const rotulos = formatos.filter((nome) => !IGNORADOS.has(slugificar(nome)));

  return {
    audio,
    roomType,
    roomLabel: rotulos.length > 0 ? rotulos.join(' · ') : null,
    is3d,
  };
}

export function normalizarCinema(bruto: RawTheater): CinemaNormalizado {
  const endereco = [bruto.address, bruto.number, bruto.neighborhood].filter(Boolean).join(', ');

  return {
    ingressoId: bruto.id,
    name: bruto.name,
    chain: bruto.corporation ?? null,
    address: endereco || null,
    cityId: bruto.cityId ?? null,
    cityName: bruto.cityName ?? null,
    urlKey: bruto.urlKey ?? null,
    totalRooms: bruto.totalRooms ?? null,
    // `enabled` ausente não significa desabilitado
    enabled: bruto.enabled ?? true,
  };
}

/**
 * Achata `dia[] → movies[] → rooms[] → sessions[]` numa lista de sessões,
 * cada uma já com o evento e o cinema a que pertence.
 */
export function normalizarSessoes(
  dias: RawShowtimeDay[],
  contexto: { theaterIngressoId: string },
): SessaoNormalizada[] {
  const sessoes: SessaoNormalizada[] = [];
  const jaVistas = new Set<string>();

  for (const dia of dias) {
    for (const filme of dia.movies ?? []) {
      for (const sala of filme.rooms ?? []) {
        for (const sessao of sala.sessions ?? []) {
          // a mesma sessão pode aparecer em mais de um dia do payload
          if (jaVistas.has(sessao.id)) continue;
          jaVistas.add(sessao.id);

          const { audio, roomType, roomLabel, is3d } = classificarTipos(sessao.types);

          sessoes.push({
            ingressoSessionId: sessao.id,
            theaterIngressoId: contexto.theaterIngressoId,
            eventIngressoId: filme.id,
            startsAt: new Date(sessao.date.localDate),
            roomType,
            roomLabel,
            roomName: sessao.room ?? sala.name ?? null,
            audio,
            is3d,
            sessionKind: classificarTipoDeSessao(filme),
            purchaseUrl: sessao.siteURL ?? null,
            // sessão bloqueada continua existindo, mas não conta como ativa
            enabled: sessao.enabled ?? true,
          });
        }
      }
    }
  }

  return sessoes;
}

/**
 * Pré-estreia vem de `inPreSale`. "Especial" não tem campo próprio na API:
 * `isReexhibition` é o mais perto que existe (reexibição, relançamento).
 */
function classificarTipoDeSessao(filme: {
  inPreSale?: boolean | null;
  isReexhibition?: boolean | null;
}): SessaoNormalizada['sessionKind'] {
  if (filme.inPreSale) return 'pre_estreia';
  if (filme.isReexhibition) return 'especial';
  return 'regular';
}

/** Extrai os eventos distintos que apareceram num payload de sessões. */
export function extrairEventosDasSessoes(dias: RawShowtimeDay[]): Map<string, RawShowtimeDay['movies'] extends (infer M)[] | null | undefined ? M : never> {
  const mapa = new Map();
  for (const dia of dias) {
    for (const filme of dia.movies ?? []) {
      if (!mapa.has(filme.id)) mapa.set(filme.id, filme);
    }
  }
  return mapa;
}

/** "166" → 166. Vazio, "0" ou lixo → null; duração nunca derruba o fluxo. */
export function minutosDeDuracao(duracao: string | null | undefined): number | null {
  if (!duracao) return null;
  const n = Number.parseInt(duracao.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
