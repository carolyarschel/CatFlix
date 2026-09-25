import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import { limparCacheDeFuso } from '../cinemas/cinemas.service';
import { montarHome } from './catalog.queries';
import type { CardDeTitulo } from './catalog.types';

/**
 * Passo 10. O que estes testes protegem são as decisões que NÃO se leem no
 * código de uma tela: quem aparece na home, quem não aparece, e de onde sai a
 * faixa colorida do pôster.
 *
 * Rodam contra o banco de desenvolvimento, que tem dado real de Campinas. Por
 * isso nenhuma asserção fala do tamanho das trilhas — só da presença ou
 * ausência dos títulos que o próprio teste cria.
 */

const PREFIXO = '__teste__home';

/**
 * Estes testes falam de CLASSIFICAÇÃO — em que trilha um título cai, que faixa
 * o card ganha —, não do corte de 24 cards que a home aplica depois.
 *
 * Sem isto eles dependiam do tamanho de Campinas: em 24/09/2026 passaram a
 * existir 32 filmes em cartaz, a trilha ordena por número de sessões futuras, e
 * um fixture com uma sessão só caía fora dos 24 — o teste falhava dizendo
 * "o órfão sumiu" quando o órfão estava classificado certinho.
 */
const SEM_CORTE = { limitePorTrilha: Number.MAX_SAFE_INTEGER };
const DIA = 86_400_000;

let temBanco = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    temBanco = true;
  } catch {
    temBanco = false;
  }
});

afterEach(async () => {
  if (!temBanco) return;
  limparCacheDeFuso();
  await prisma.session.deleteMany({ where: { ingressoSessionId: { startsWith: PREFIXO } } });
  await prisma.availability.deleteMany({ where: { title: { title: { startsWith: PREFIXO } } } });
  await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
  await prisma.cinema.deleteMany({ where: { ingressoId: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function cinemaDeTeste() {
  return prisma.cinema.create({
    data: {
      ingressoId: `${PREFIXO}-cine`,
      name: `${PREFIXO} Cine`,
      timezone: 'America/Sao_Paulo',
    },
    select: { id: true },
  });
}

async function titulo(
  sufixo: string,
  dados: Partial<{ status: 'matched' | 'orphan' | 'not_a_film' | 'merged'; posterUrl: string }> = {},
) {
  return prisma.title.create({
    data: {
      title: `${PREFIXO}${sufixo}`,
      normalizedTitle: `${PREFIXO}${sufixo}`.toLowerCase(),
      status: dados.status ?? 'matched',
      posterUrl: dados.posterUrl ?? null,
    },
    select: { id: true },
  });
}

async function sessao(
  titleId: string,
  cinemaId: string,
  emDias: number,
  tipo: 'regular' | 'pre_estreia' = 'regular',
) {
  await prisma.session.create({
    data: {
      ingressoSessionId: `${PREFIXO}-${titleId}-${emDias}-${tipo}`,
      titleId,
      cinemaId,
      startsAt: new Date(Date.now() + emDias * DIA),
      roomType: 'imax',
      audio: 'legendado',
      sessionKind: tipo,
      active: true,
    },
  });
}

async function disponibilidade(titleId: string, status: 'em_cartaz' | 'pre_estreia' | 'em_breve') {
  await prisma.availability.create({
    data: { titleId, source: 'cinema', status },
  });
}

/** Acha um card do teste em qualquer trilha da home. */
function acharCard(trilhas: Array<{ id: string; itens: CardDeTitulo[] }>, id: string) {
  for (const trilha of trilhas) {
    const card = trilha.itens.find((i) => i.id === id);
    if (card) return { card, trilha: trilha.id };
  }
  return null;
}

describe('montarHome', () => {
  it('mostra título órfão — §2: nenhum filme some', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const cine = await cinemaDeTeste();
    const orfao = await titulo('-orfao', { status: 'orphan' });
    await sessao(orfao.id, cine.id, 2);
    await disponibilidade(orfao.id, 'em_cartaz');

    const home = await montarHome('catflix', SEM_CORTE);
    const achado = acharCard(home.trilhas, orfao.id);

    expect(achado).not.toBeNull();
    expect(achado?.card.orfao).toBe(true);
    expect(achado?.trilha).toBe('em-cartaz');
  });

  it('esconde não-filme e lápide de merge', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const cine = await cinemaDeTeste();
    const naoFilme = await titulo('-opera', { status: 'not_a_film' });
    const absorvido = await titulo('-absorvido', { status: 'merged' });

    for (const t of [naoFilme, absorvido]) {
      await sessao(t.id, cine.id, 2);
      await disponibilidade(t.id, 'em_cartaz');
    }

    const home = await montarHome('catflix', SEM_CORTE);

    expect(acharCard(home.trilhas, naoFilme.id)).toBeNull();
    expect(acharCard(home.trilhas, absorvido.id)).toBeNull();
  });

  it('a faixa de pré-estreia vem do Availability, não do sessionKind', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const cine = await cinemaDeTeste();

    // pré-estreia de verdade, com sessão marcada como REGULAR
    const real = await titulo('-preestreia');
    await sessao(real.id, cine.id, 1, 'regular');
    await disponibilidade(real.id, 'pre_estreia');

    // em cartaz cujas sessões estão todas marcadas como pre_estreia — é o
    // defeito medido do `inPreSale`, que atinge 434 das 504 sessões reais
    const falso = await titulo('-emcartaz');
    await sessao(falso.id, cine.id, 1, 'pre_estreia');
    await sessao(falso.id, cine.id, 30, 'pre_estreia');
    await disponibilidade(falso.id, 'em_cartaz');

    const home = await montarHome('catflix', SEM_CORTE);

    // a pré-estreia de verdade ganha faixa com horário ("Qui · 20h40")
    expect(acharCard(home.trilhas, real.id)?.card.faixa).toMatch(/·\s\d{2}h\d{2}$/);

    // o em cartaz NÃO ganha faixa de horário só porque o campo está torto.
    // `faixa` pode ser null aqui, que é justamente o resultado certo — por isso
    // a comparação é sobre a string, não um `not.toMatch` (que rejeita null).
    const faixaDoFalso = acharCard(home.trilhas, falso.id)?.card.faixa;
    expect(faixaDoFalso ?? '').not.toMatch(/·\s\d{2}h\d{2}$/);
  });

  it('só chama de "Última semana" quando outros filmes já têm sessão mais longe', async ({
    skip,
  }) => {
    if (!temBanco) skip('sem Postgres');

    const cine = await cinemaDeTeste();

    // acabando: última sessão daqui a 3 dias
    const acabando = await titulo('-acabando');
    await sessao(acabando.id, cine.id, 3);
    await disponibilidade(acabando.id, 'em_cartaz');

    // garante que o horizonte do catálogo passa de uma semana, sem depender do
    // dado real que estiver no banco
    const longe = await titulo('-longe');
    await sessao(longe.id, cine.id, 30);
    await disponibilidade(longe.id, 'em_cartaz');

    const home = await montarHome('catflix', SEM_CORTE);

    expect(acharCard(home.trilhas, acabando.id)?.card.faixa).toBe('Última semana');
    expect(acharCard(home.trilhas, longe.id)?.card.faixa).toBeNull();
  });

  it('devolve o perfil pedido e rejeita perfil que não existe', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');

    const home = await montarHome('hburso');
    expect(home.perfil.id).toBe('hburso');
    expect(home.perfil.inicial).toBe('H');

    await expect(montarHome('ninguem')).rejects.toThrow(/não existe/);
  });
});
