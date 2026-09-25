import roomConfig from '../../config/room-types.json';

/**
 * Formatação de apresentação do catálogo (§12).
 *
 * Fica no backend, e não no frontend, por um motivo só: a linha "Kinoplex · XD
 * · DUB" do PosterCard é um resumo de N sessões, e quem sabe reduzir N sessões
 * a uma linha é quem tem as N sessões na mão. Mandar as 40 sessões de um filme
 * para o celular montar a mesma string seria pior em banda e em consistência —
 * a fila de revisão e o detalhe precisam do mesmo rótulo.
 *
 * Os rótulos longos ("IMAX", "Dublado") vêm de `config/room-types.json`, a
 * mesma fonte que as tags automáticas usam. Formato novo que o ingresso
 * invente aparece com o slug em Title Case, nunca vazio.
 */

const PRIORIDADE_DE_SALA: string[] = roomConfig.prioridade;
const ROTULOS_DE_SALA = roomConfig.rotulos as Record<string, string>;

/** Abreviações do card. O espaço é de 150 px: "Legendado" não cabe ao lado do cinema. */
const AUDIO_CURTO: Record<string, string> = {
  dublado: 'DUB',
  legendado: 'LEG',
  original: 'NAC',
};

const AUDIO_LONGO: Record<string, string> = {
  dublado: 'Dublado',
  legendado: 'Legendado',
  original: 'Áudio original',
};

export function rotuloDeSala(slug: string): string {
  const conhecido = ROTULOS_DE_SALA[slug];
  if (conhecido) return conhecido;

  return slug
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

export function rotuloDeAudio(audio: string, forma: 'curta' | 'longa' = 'longa'): string {
  const tabela = forma === 'curta' ? AUDIO_CURTO : AUDIO_LONGO;
  return tabela[audio] ?? audio;
}

/**
 * Escolhe UM tipo de sala entre os que o filme tem, pela ordem de prioridade do
 * `room-types.json` — a mesma que o parser usa para decidir o `roomType` de uma
 * sessão com vários formatos. Sem isso o card mostraria "Laser" num filme que
 * também passa em IMAX.
 *
 * Slug fora da lista perde para os conhecidos, mas ganha de nada.
 */
export function salaMaisNotavel(salas: readonly string[]): string | null {
  if (salas.length === 0) return null;

  const ordenadas = [...salas].sort((a, b) => {
    const ia = PRIORIDADE_DE_SALA.indexOf(a);
    const ib = PRIORIDADE_DE_SALA.indexOf(b);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });

  return ordenadas[0] ?? null;
}

/** "Kinoplex · XD · DUB". Partes ausentes somem sem deixar separador solto. */
export function linhaDeCinema(dados: {
  cinema: string | null;
  salas: readonly string[];
  audios: readonly string[];
  tem3d: boolean;
}): string | null {
  const sala = salaMaisNotavel(dados.salas);
  const partes = [
    dados.cinema,
    sala ? rotuloDeSala(sala) : dados.tem3d ? '3D' : null,
    dados.audios.length === 1 ? rotuloDeAudio(dados.audios[0]!, 'curta') : null,
  ].filter((p): p is string => Boolean(p));

  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * Nota do IMDb como a Carol lê: 8,5 e não 8.5.
 *
 * A vírgula é feita aqui, e não com `toLocaleString` no navegador, para o card
 * não depender do idioma do aparelho — o app é pt-BR mesmo num celular em
 * inglês.
 */
export function formatarNotaImdb(nota: number | null): string | null {
  if (nota === null) return null;
  return nota.toFixed(1).replace('.', ',');
}

export function formatarNotaRt(nota: number | null): string | null {
  if (nota === null) return null;
  return `${nota}%`;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Lê uma data no fuso da CIDADE, não no do servidor.
 *
 * O Catploy pode rodar em UTC: sem isto, uma sessão de 23h59 de quinta vira
 * "Sex · 02h59" na faixa do pôster — e a Carol perderia a pré-estreia.
 */
function partesNoFuso(data: Date, fuso: string): Record<string, string> {
  const formatador = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return Object.fromEntries(formatador.formatToParts(data).map((p) => [p.type, p.value]));
}

/** Dia da semana no fuso da cidade, 0 = domingo. */
function diaDaSemanaNoFuso(data: Date, fuso: string): number {
  // `weekday: 'short'` em pt-BR devolve "qui." — comparar string seria frágil.
  // O caminho estável é reconstruir a data no fuso e perguntar ao Date.
  const p = partesNoFuso(data, fuso);
  const iso = `${p.year}-${p.month}-${p.day}T00:00:00Z`;
  return new Date(iso).getUTCDay();
}

/** "Qui · 23h59" — a faixa de urgência do modelo de design. */
export function formatarSessao(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  const dia = DIAS[diaDaSemanaNoFuso(data, fuso)] ?? '';
  return `${dia} · ${p.hour}h${p.minute}`;
}

/** "15 out" — estreia de um filme que ainda não tem sessão. */
export function formatarEstreia(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  const mes = MESES[Number(p.month) - 1] ?? '';
  return `${Number(p.day)} ${mes}`;
}
