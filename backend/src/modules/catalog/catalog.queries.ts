import { Prisma } from '@prisma/client';
import type { AvailabilityStatus, TagFacet, UserTitleStatus } from '@prisma/client';
import { NotFoundError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
// Importado do arquivo do serviço, e não do barril `../cinemas`, de propósito:
// o barril exporta as rotas, e rota importando catálogo importando rota fecharia
// um ciclo de módulos.
import { fusoDaCidade, idadeDosDadosEmHoras } from '../cinemas/cinemas.service';
import { listarSessoes } from '../cinemas/cinemas.queries';
import {
  formatarEstreia,
  formatarNotaImdb,
  formatarNotaRt,
  formatarSessao,
  linhaDeCinema,
  rotuloDeAudio,
  rotuloDeSala,
  salaMaisNotavel,
} from './catalog.format';
import type {
  CardDeTitulo,
  DetalheDoTitulo,
  Home,
  MarcaDeUsuario,
  TituloDaLista,
  TrilhaDaHome,
} from './catalog.types';

/**
 * Leitura do catálogo: o que as telas do §12 consomem.
 *
 * Duas regras atravessam o arquivo:
 *
 * 1. **Título órfão aparece.** Todo filtro exclui `merged` (lápide de merge) e
 *    `not_a_film`, mas nunca `orphan` — o §2 diz que nenhum filme some, e um
 *    evento sem metadata do TMDB ainda é uma sessão que existe no cinema.
 * 2. **Uma consulta por conjunto, não por card.** As trilhas da home somam
 *    dezenas de títulos; agregar sessão a sessão dentro de um laço daria N+1 e
 *    a home é a tela mais aberta do app.
 */

/** Horas de dado velho a partir das quais a tela mostra "dados de X horas atrás" (§8). */
const LIMITE_DE_DEGRADACAO_EM_HORAS = 12;

/** Quantos cards por trilha. O suficiente para rolar; não o catálogo inteiro. */
/**
 * Quantos cards cabem numa trilha.
 *
 * O que passa disso não some: a trilha devolve `total` e a home acende um
 * "Ver todos" que abre a lista inteira numa página própria.
 */
const ITENS_POR_TRILHA = 24;

const MILISSEGUNDOS_EM_UM_DIA = 86_400_000;

/**
 * Os status que aparecem no app. `merged` virou outro título e `not_a_film` é
 * ópera, show ou transmissão — a fila de revisão já decidiu que não é filme.
 *
 * Exportado porque o painel de tags precisa contar EXATAMENTE isto: a contagem
 * que o item mostra tem de ser o número de cards que aparece ao clicar nele.
 */
export const STATUS_VISIVEIS = ['matched', 'orphan'] as const;

interface AgregadoDeSessoes {
  titleId: string;
  cinema: string | null;
  salas: string[];
  audios: string[];
  tem3d: boolean;
  proxima: Date | null;
  proximaPreEstreia: Date | null;
  ultima: Date | null;
  futuras: number;
}

/**
 * Resume as sessões FUTURAS de vários títulos numa linha cada.
 *
 * Sessão passada não entra: o card diz onde dá para ver o filme hoje, não onde
 * dava na semana passada.
 */
async function agregarSessoes(titleIds: string[]): Promise<Map<string, AgregadoDeSessoes>> {
  if (titleIds.length === 0) return new Map();

  const linhas = await prisma.$queryRaw<AgregadoDeSessoes[]>`
    WITH futuras AS (
      SELECT s.title_id, s.room_type, s.audio, s.is_3d, s.starts_at, s.session_kind,
             c.name AS cinema_name
      FROM sessions s
      JOIN cinemas c ON c.id = s.cinema_id
      WHERE s.active = true
        AND s.starts_at >= now()
        AND s.title_id IN (${Prisma.join(titleIds)})
    ),
    -- o cinema do card é aquele onde o filme mais passa, não um qualquer
    principal AS (
      SELECT DISTINCT ON (title_id) title_id, cinema_name
      FROM (SELECT title_id, cinema_name, count(*) AS n FROM futuras GROUP BY 1, 2) x
      ORDER BY title_id, n DESC, cinema_name
    )
    SELECT
      f.title_id AS "titleId",
      max(p.cinema_name) AS cinema,
      coalesce(array_agg(DISTINCT f.room_type) FILTER (WHERE f.room_type <> 'normal'), '{}') AS salas,
      coalesce(array_agg(DISTINCT f.audio::text) FILTER (WHERE f.audio <> 'desconhecido'), '{}') AS audios,
      coalesce(bool_or(f.is_3d), false) AS "tem3d",
      min(f.starts_at) AS proxima,
      min(f.starts_at) FILTER (WHERE f.session_kind = 'pre_estreia') AS "proximaPreEstreia",
      max(f.starts_at) AS ultima,
      count(*)::int AS futuras
    FROM futuras f
    LEFT JOIN principal p ON p.title_id = f.title_id
    GROUP BY f.title_id
  `;

  return new Map(linhas.map((l) => [l.titleId, l]));
}

/**
 * Até quando o catálogo INTEIRO tem sessão publicada.
 *
 * É o guarda-chuva da faixa "Última semana": o ingresso publica a grade em
 * ondas, e sem esta referência todo filme viraria "última semana" na véspera
 * de uma nova onda — um alarme falso por semana, toda semana.
 */
async function horizonteDeSessoes(): Promise<Date | null> {
  const [linha] = await prisma.$queryRaw<Array<{ ate: Date | null }>>`
    SELECT max(starts_at) AS ate FROM sessions WHERE active = true AND starts_at >= now()
  `;
  return linha?.ate ?? null;
}

/**
 * Quem marcou cada título. Só `marcado` vira círculo no pôster: "quero ver" é
 * intenção e "visto" é passado — nenhum dos dois é o que o modelo mostra.
 */
async function marcasDosUsuarios(titleIds: string[]): Promise<Map<string, MarcaDeUsuario[]>> {
  if (titleIds.length === 0) return new Map();

  const estados = await prisma.userTitleState.findMany({
    where: { titleId: { in: titleIds }, status: 'marcado' },
    select: {
      titleId: true,
      user: { select: { id: true, initial: true, accent: true } },
    },
    orderBy: { userId: 'asc' },
  });

  const porTitulo = new Map<string, MarcaDeUsuario[]>();
  for (const estado of estados) {
    const lista = porTitulo.get(estado.titleId) ?? [];
    lista.push({
      userId: estado.user.id,
      inicial: estado.user.initial,
      acento: estado.user.accent,
    });
    porTitulo.set(estado.titleId, lista);
  }

  return porTitulo;
}

interface TituloCru {
  id: string;
  title: string;
  year: number | null;
  status: string;
  posterUrl: string | null;
  releaseDate: Date | null;
  imdbRating: Prisma.Decimal | null;
  rtRating: number | null;
}

const SELECAO_DE_CARD = {
  id: true,
  title: true,
  year: true,
  status: true,
  posterUrl: true,
  releaseDate: true,
  imdbRating: true,
  rtRating: true,
} as const;

interface ContextoDoCard {
  sessoes: Map<string, AgregadoDeSessoes>;
  marcas: Map<string, MarcaDeUsuario[]>;
  /** títulos em pré-estreia segundo a lista do próprio ingresso */
  emPreEstreia: Set<string>;
  horizonte: Date | null;
  fuso: string;
  agora: Date;
}

/**
 * Quais destes títulos estão em pré-estreia.
 *
 * ⚠️ Vem de `Availability`, e **não** de `Session.sessionKind`, por um motivo
 * medido: hoje 434 das 504 sessões futuras estão gravadas como `pre_estreia`,
 * e os 13 títulos em cartaz têm todos pelo menos uma. O parser deriva o tipo da
 * sessão de `movies[].inPreSale`, que no ingresso significa **pré-venda**
 * (bilhete já à venda), não pré-estreia (sessão antes da estreia oficial) —
 * ver o aviso no README. Enquanto o `sessionKind` não for reclassificado, a
 * faixa do pôster se apoia na lista de pré-estreias da própria API, que o
 * `Availability` já guarda e que bate com a realidade (8 títulos).
 */
async function idsEmPreEstreia(titleIds: string[]): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();

  const linhas = await prisma.availability.findMany({
    where: {
      titleId: { in: titleIds },
      source: 'cinema',
      status: 'pre_estreia',
      endedAt: null,
    },
    select: { titleId: true },
  });

  return new Set(linhas.map((l) => l.titleId));
}

/**
 * A faixa colorida no rodapé do pôster (§12). Só existe quando há urgência de
 * verdade — uma faixa em todo card não avisa nada.
 */
function faixaDoCard(
  titleId: string,
  agregado: AgregadoDeSessoes | undefined,
  contexto: ContextoDoCard,
): string | null {
  if (!agregado) return null;

  // pré-estreia: a faixa é o horário da próxima sessão, que é a informação
  // escassa — quem vai numa pré-estreia vai naquele horário ou não vai
  if (contexto.emPreEstreia.has(titleId) && agregado.proxima) {
    return formatarSessao(agregado.proxima, contexto.fuso);
  }

  if (!agregado.ultima || !contexto.horizonte) return null;

  const daquiASeteDias = new Date(contexto.agora.getTime() + 7 * MILISSEGUNDOS_EM_UM_DIA);

  // "a última sessão deste filme é antes de uma semana" só significa alguma
  // coisa se OUTROS filmes já têm sessão depois disso
  if (agregado.ultima <= daquiASeteDias && contexto.horizonte > daquiASeteDias) {
    return 'Última semana';
  }

  return null;
}

function montarCard(titulo: TituloCru, contexto: ContextoDoCard): CardDeTitulo {
  const agregado = contexto.sessoes.get(titulo.id);

  const linhaDeSessao = agregado
    ? linhaDeCinema({
        cinema: agregado.cinema,
        salas: agregado.salas,
        audios: agregado.audios,
        tem3d: agregado.tem3d,
      })
    : null;

  // Sem sessão nenhuma (caso dos "em breve"), a linha vira a data de estreia.
  //
  // ⚠️ Só se a estreia ainda não passou. O `releaseDate` vem do TMDB e é a
  // estreia ORIGINAL: num relançamento como "Ran" ou "Shrek" ele aponta para os
  // anos 80 e 2001. Como a faixa mostra só dia e mês, "Estreia 21 jun" seria
  // lido como junho que vem — o card mentiria com a cara mais séria do mundo.
  const estreiaFutura =
    titulo.releaseDate && titulo.releaseDate.getTime() > contexto.agora.getTime()
      ? `Estreia ${formatarEstreia(titulo.releaseDate, contexto.fuso)}`
      : null;

  const linha = linhaDeSessao ?? estreiaFutura;

  return {
    id: titulo.id,
    titulo: titulo.title,
    posterUrl: titulo.posterUrl,
    ano: titulo.year,
    orfao: titulo.status === 'orphan',
    imdb: formatarNotaImdb(titulo.imdbRating === null ? null : Number(titulo.imdbRating)),
    rt: formatarNotaRt(titulo.rtRating),
    linha,
    marcadoPor: contexto.marcas.get(titulo.id) ?? [],
    faixa: faixaDoCard(titulo.id, agregado, contexto),
  };
}

/** Monta o contexto compartilhado por todos os cards de uma resposta. */
async function contextoPara(titleIds: string[]): Promise<ContextoDoCard> {
  const [sessoes, marcas, emPreEstreia, horizonte, fuso] = await Promise.all([
    agregarSessoes(titleIds),
    marcasDosUsuarios(titleIds),
    idsEmPreEstreia(titleIds),
    horizonteDeSessoes(),
    fusoDaCidade(),
  ]);

  return { sessoes, marcas, emPreEstreia, horizonte, fuso, agora: new Date() };
}

/** Ids com disponibilidade aberta numa fonte/estado — a base de cada trilha. */
async function idsComDisponibilidade(status: AvailabilityStatus): Promise<string[]> {
  const linhas = await prisma.availability.findMany({
    where: {
      source: 'cinema',
      status,
      endedAt: null,
      title: { status: { in: [...STATUS_VISIVEIS] } },
    },
    select: { titleId: true },
  });

  return linhas.map((l) => l.titleId);
}

// ─────────────────────────────────────────────────────────────
// HOME (§10: dados já agrupados para hero + trilhas)
// ─────────────────────────────────────────────────────────────

export async function montarHome(
  userId: string,
  opcoes: { limitePorTrilha?: number } = {},
): Promise<Home> {
  // O corte é decisão de APRESENTAÇÃO, não de classificação. O parâmetro existe
  // para os testes poderem falar de "este filme entra na trilha em-cartaz" sem
  // depender de quantos filmes Campinas tem hoje — em 24/09/2026 são 32 em
  // cartaz para um corte de 24, e um fixture com uma sessão só ficava de fora
  // por ranking, não por classificação errada. A rota não passa nada.
  const limite = opcoes.limitePorTrilha ?? ITENS_POR_TRILHA;
  const perfil = await prisma.user.findUnique({ where: { id: userId } });
  if (!perfil) {
    throw new NotFoundError(`Perfil "${userId}" não existe.`);
  }

  const [emCartaz, preEstreia, emBreve, marcados] = await Promise.all([
    idsComDisponibilidade('em_cartaz'),
    idsComDisponibilidade('pre_estreia'),
    idsComDisponibilidade('em_breve'),
    prisma.userTitleState
      .findMany({
        where: { status: 'marcado', title: { status: { in: [...STATUS_VISIVEIS] } } },
        orderBy: { statusChangedAt: 'desc' },
        select: { titleId: true },
      })
      .then((linhas) => [...new Set(linhas.map((l) => l.titleId))]),
  ]);

  const todos = [...new Set([...emCartaz, ...preEstreia, ...emBreve, ...marcados])];

  const [titulos, contexto, idade] = await Promise.all([
    prisma.title.findMany({ where: { id: { in: todos } }, select: SELECAO_DE_CARD }),
    contextoPara(todos),
    idadeDosDadosEmHoras(),
  ]);

  const porId = new Map(titulos.map((t) => [t.id, t]));
  const cardsPorId = new Map<string, CardDeTitulo>();
  const cardDe = (id: string): CardDeTitulo | null => {
    const existente = cardsPorId.get(id);
    if (existente) return existente;

    const titulo = porId.get(id);
    if (!titulo) return null;

    const card = montarCard(titulo, contexto);
    cardsPorId.set(id, card);
    return card;
  };

  const cards = (ids: string[]): CardDeTitulo[] =>
    ids.map(cardDe).filter((c): c is CardDeTitulo => c !== null);

  /** Mais sessões futuras primeiro: é o proxy honesto de "está em toda parte". */
  const porQuantidadeDeSessoes = (a: CardDeTitulo, b: CardDeTitulo): number =>
    (contexto.sessoes.get(b.id)?.futuras ?? 0) - (contexto.sessoes.get(a.id)?.futuras ?? 0) ||
    a.titulo.localeCompare(b.titulo, 'pt-BR');

  /** Quem estreia antes aparece antes — a pré-estreia é sobre chegar a tempo. */
  const porProximaSessao = (a: CardDeTitulo, b: CardDeTitulo): number => {
    const sa = contexto.sessoes.get(a.id)?.proxima?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sb = contexto.sessoes.get(b.id)?.proxima?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return sa - sb || a.titulo.localeCompare(b.titulo, 'pt-BR');
  };

  /**
   * "Em breve" pela estreia que ainda vai acontecer.
   *
   * Estreia no passado é relançamento (o `releaseDate` do TMDB é o original),
   * e ordenar por ela jogaria "Shrek" e "A Paixão de Cristo" para o começo da
   * trilha do que está por vir. Essas vão para o fim, em ordem alfabética.
   */
  const porEstreia = (a: CardDeTitulo, b: CardDeTitulo): number => {
    const agora = contexto.agora.getTime();
    const quando = (id: string): number => {
      const data = porId.get(id)?.releaseDate?.getTime();
      return data && data > agora ? data : Number.MAX_SAFE_INTEGER;
    };
    return quando(a.id) - quando(b.id) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  };

  const trilhas: TrilhaDaHome[] = [
    { id: 'em-cartaz', titulo: 'Em cartaz agora', itens: cards(emCartaz).sort(porQuantidadeDeSessoes) },
    { id: 'pre-estreias', titulo: 'Pré-estreias', itens: cards(preEstreia).sort(porProximaSessao) },
    { id: 'em-breve', titulo: 'Em breve', itens: cards(emBreve).sort(porEstreia) },
    // já vem ordenada pelo banco (marcação mais recente primeiro)
    { id: 'marcados', titulo: 'Já marcados por vocês', itens: cards(marcados) },
  ]
    // o total é contado ANTES do corte: é ele que diz à home que há mais
    .map((t) => ({ ...t, total: t.itens.length, itens: t.itens.slice(0, limite) }))
    // trilha vazia não vira título de seção solto na tela
    .filter((t) => t.itens.length > 0);

  return {
    perfil: {
      id: perfil.id,
      nome: perfil.displayName,
      inicial: perfil.initial,
      acento: perfil.accent,
      acentoSecundario: perfil.accentSecondary,
    },
    hero: await montarHero(emCartaz.length > 0 ? emCartaz : preEstreia, contexto, porId),
    trilhas,
    dados: {
      idadeEmHoras: idade === null ? null : Math.round(idade * 10) / 10,
      degradado: idade !== null && idade > LIMITE_DE_DEGRADACAO_EM_HORAS,
    },
  };
}

/**
 * O hero é um destaque editorial sem editor.
 *
 * Critério: **onde o filme mais passa**, desempatado pela nota. "Está em toda
 * sala de toda rede" é o sinal honesto de lançamento grande; só a nota colocava
 * "Vingadores: Ultimato" de 2019, em duas sessões de relançamento, no topo da
 * home todo dia.
 *
 * Só entra quem tem pôster: um hero sem imagem é um retângulo cinza ocupando
 * 424 px da tela.
 */
async function montarHero(
  ids: string[],
  contexto: ContextoDoCard,
  porId: Map<string, TituloCru>,
): Promise<Home['hero']> {
  const candidatos = ids
    .map((id) => porId.get(id))
    .filter((t): t is TituloCru => Boolean(t) && Boolean(t?.posterUrl));

  if (candidatos.length === 0) return null;

  const escolhido = candidatos.sort((a, b) => {
    const sa = contexto.sessoes.get(a.id)?.futuras ?? 0;
    const sb = contexto.sessoes.get(b.id)?.futuras ?? 0;
    if (sa !== sb) return sb - sa;

    const na = a.imdbRating === null ? -1 : Number(a.imdbRating);
    const nb = b.imdbRating === null ? -1 : Number(b.imdbRating);
    return nb - na;
  })[0]!;

  const completo = await prisma.title.findUnique({
    where: { id: escolhido.id },
    select: {
      id: true,
      title: true,
      posterUrl: true,
      backdropUrl: true,
      genres: { select: { genre: { select: { name: true } } }, take: 1 },
    },
  });

  if (!completo) return null;

  const agregado = contexto.sessoes.get(escolhido.id);
  const sala = agregado ? salaMaisNotavel(agregado.salas) : null;
  const audio = agregado?.audios.length === 1 ? agregado.audios[0]! : null;

  return {
    id: completo.id,
    titulo: completo.title,
    posterUrl: completo.posterUrl,
    backdropUrl: completo.backdropUrl,
    // "Filme • Ficção científica • IMAX • Legendado" (§12)
    taxonomia: [
      'Filme',
      completo.genres[0]?.genre.name ?? null,
      sala ? rotuloDeSala(sala) : null,
      audio ? rotuloDeAudio(audio) : null,
    ].filter((p): p is string => Boolean(p)),
    marcadoPor: contexto.marcas.get(completo.id) ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
// LISTA E DETALHE (§10)
// ─────────────────────────────────────────────────────────────

/**
 * Uma tag no filtro da lista.
 *
 * A faceta é opcional porque `?tag=imax` (só o slug) continua valendo, mas o
 * painel de tags manda sempre `sala:imax`. Motivo: o slug sozinho não é único
 * entre facetas. Hoje não há colisão no banco (medido em 24/09/2026: 13 tags,
 * nenhum `value` repetido), mas as tags manuais do passo 11 são texto digitado
 * pelas duas pessoas — uma tag manual "IMAX" passaria a casar também com a
 * sala IMAX, e o filtro **abriria** em silêncio em vez de fechar.
 */
export interface TagFiltrada {
  facet?: TagFacet;
  value: string;
}

export interface FiltrosDeTitulos {
  availability?: AvailabilityStatus;
  /** tags; várias tags somam (E), não alternam (OU) */
  tags?: TagFiltrada[];
  /** id do cinema NO INGRESSO — filtrar por nome é proibido (§3) */
  cinema?: string;
  user?: string;
  status?: UserTitleStatus;
  q?: string;
  limite?: number;
}

export async function listarTitulos(filtros: FiltrosDeTitulos): Promise<TituloDaLista[]> {
  const where: Prisma.TitleWhereInput = {
    status: { in: [...STATUS_VISIVEIS] },
    ...(filtros.availability
      ? {
          availabilities: {
            some: { source: 'cinema', status: filtros.availability, endedAt: null },
          },
        }
      : {}),
    ...(filtros.cinema
      ? { sessions: { some: { active: true, cinema: { ingressoId: filtros.cinema } } } }
      : {}),
    ...(filtros.user || filtros.status
      ? {
          userStates: {
            some: {
              ...(filtros.user ? { userId: filtros.user } : {}),
              ...(filtros.status ? { status: filtros.status } : {}),
            },
          },
        }
      : {}),
    ...(filtros.q
      ? {
          OR: [
            { title: { contains: filtros.q, mode: 'insensitive' } },
            { originalTitle: { contains: filtros.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    // uma cláusula por tag: "IMAX E legendado", não "IMAX ou legendado"
    ...(filtros.tags && filtros.tags.length > 0
      ? {
          AND: filtros.tags.map((tag) => ({
            tags: {
              some: {
                tag: { value: tag.value, ...(tag.facet ? { facet: tag.facet } : {}) },
              },
            },
          })),
        }
      : {}),
  };

  const titulos = await prisma.title.findMany({
    where,
    orderBy: [{ title: 'asc' }],
    take: filtros.limite ?? 200,
    select: {
      ...SELECAO_DE_CARD,
      availabilities: {
        where: { source: 'cinema', endedAt: null },
        select: { status: true },
      },
    },
  });

  const contexto = await contextoPara(titulos.map((t) => t.id));

  return titulos.map((t) => ({
    ...montarCard(t, contexto),
    disponibilidade: t.availabilities.map((a) => a.status),
  }));
}

export async function detalheDoTitulo(id: string): Promise<DetalheDoTitulo> {
  const titulo = await prisma.title.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      originalTitle: true,
      year: true,
      runtimeMinutes: true,
      overview: true,
      posterUrl: true,
      backdropUrl: true,
      status: true,
      imdbRating: true,
      rtRating: true,
      ratingsUpdatedAt: true,
      genres: { select: { genre: { select: { name: true } } } },
      credits: {
        select: { role: true, character: true, order: true, person: { select: { name: true } } },
        orderBy: [{ role: 'asc' }, { order: 'asc' }],
      },
      companies: { select: { company: { select: { name: true } } } },
      tags: {
        select: {
          origin: true,
          tag: {
            select: { id: true, facet: true, value: true, label: true, ownerId: true },
          },
        },
      },
      userStates: {
        select: {
          status: true,
          statusChangedAt: true,
          user: { select: { id: true, initial: true, accent: true } },
        },
      },
      availabilities: {
        where: { endedAt: null },
        select: { status: true, firstSeenAt: true },
      },
      // Vários eventos do ingresso apontam para o mesmo Title (dublado, IMAX,
      // pré-estreia), e cada um tem sua página. Todos levam ao mesmo filme, então
      // o botão do §1 usa o mais recente — é o que tem o slug atual quando o
      // ingresso renomeia.
      externalIds: {
        where: { source: 'ingresso', sourceUrl: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { sourceUrl: true },
      },
    },
  });

  if (!titulo) {
    throw new NotFoundError(`Título "${id}" não existe.`);
  }

  // por que este título ainda não tem metadata — o card órfão precisa dizer isso
  const [pendencia, sessoes] = await Promise.all([
    titulo.status === 'orphan'
      ? prisma.reviewItem.findFirst({
          where: { subjectTitleId: id, status: 'open' },
          orderBy: { createdAt: 'asc' },
          select: { reason: true, createdAt: true },
        })
      : Promise.resolve(null),
    listarSessoes({ titleId: id }),
  ]);

  return {
    id: titulo.id,
    titulo: titulo.title,
    tituloOriginal: titulo.originalTitle,
    ano: titulo.year,
    duracaoMinutos: titulo.runtimeMinutes,
    sinopse: titulo.overview,
    posterUrl: titulo.posterUrl,
    backdropUrl: titulo.backdropUrl,
    orfao: titulo.status === 'orphan',
    pendencia: pendencia ? { motivo: pendencia.reason, desde: pendencia.createdAt } : null,
    notas: {
      imdb: formatarNotaImdb(titulo.imdbRating === null ? null : Number(titulo.imdbRating)),
      rt: formatarNotaRt(titulo.rtRating),
      atualizadasEm: titulo.ratingsUpdatedAt,
    },
    generos: titulo.genres.map((g) => g.genre.name),
    diretores: titulo.credits
      .filter((c) => c.role === 'director')
      .map((c) => ({ nome: c.person.name, personagem: null })),
    elenco: titulo.credits
      .filter((c) => c.role === 'cast')
      .map((c) => ({ nome: c.person.name, personagem: c.character })),
    estudios: titulo.companies.map((c) => c.company.name),
    tags: titulo.tags.map((t) => ({
      id: t.tag.id,
      facet: t.tag.facet,
      value: t.tag.value,
      label: t.tag.label,
      origin: t.origin,
      ownerId: t.tag.ownerId,
    })),
    estados: titulo.userStates.map((e) => ({
      userId: e.user.id,
      inicial: e.user.initial,
      acento: e.user.accent,
      status: e.status,
      desde: e.statusChangedAt,
    })),
    disponibilidade: titulo.availabilities.map((a) => ({
      status: a.status,
      desde: a.firstSeenAt,
    })),
    sessoes,
    ingressoUrl: titulo.externalIds[0]?.sourceUrl ?? null,
  };
}
