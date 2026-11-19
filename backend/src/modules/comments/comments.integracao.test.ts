import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import { mergeTitles } from '../catalog/catalog.merge';
import { listarAssistidos } from '../library/library.assistidos';
import {
  detalheDoAcervo,
  registrarQueAssistimos,
  removerDoCatalogo,
  restaurarNoCatalogo,
} from '../library/library.service';
import { definirNota } from '../ratings';
import { TAMANHO_MAXIMO_DO_COMENTARIO, definirComentario, removerComentario } from './comments.service';

/** Comentários de cada pessoa sobre o filme, contra o banco de desenvolvimento. */

const PREFIXO = '__teste__comentario';

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
  // os comentários caem em cascata com o Title
  if (temBanco) await prisma.title.deleteMany({ where: { title: { startsWith: PREFIXO } } });
});

afterAll(async () => {
  if (temBanco) await prisma.$disconnect();
});

async function titulo(sufixo: string) {
  return prisma.title.create({
    data: { title: `${PREFIXO}${sufixo}`, normalizedTitle: `${PREFIXO}${sufixo}`, status: 'matched' },
    select: { id: true },
  });
}

describe('comentário', () => {
  it('grava, edita, e salvar vazio apaga; cada pessoa tem o seu', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const t = await titulo('-edita');

    await definirComentario(t.id, 'CAT', '  Chorei no final.\r\nDe novo.  ');
    await definirComentario(t.id, 'BEAR', 'Longo demais.');
    let detalhe = await detalheDoAcervo(t.id, 'CAT');
    expect(detalhe.pessoas.map((p) => p.comentario)).toEqual(['Chorei no final.\nDe novo.', 'Longo demais.']);

    // editar reescreve a mesma linha
    await definirComentario(t.id, 'CAT', 'Mudei de ideia.');
    expect(await prisma.comment.count({ where: { titleId: t.id } })).toBe(2);

    await definirComentario(t.id, 'CAT', '   ');
    detalhe = await detalheDoAcervo(t.id, 'CAT');
    expect(detalhe.pessoas.map((p) => p.comentario)).toEqual([null, 'Longo demais.']);

    // e voltar a escrever reativa
    await definirComentario(t.id, 'CAT', 'Voltei.');
    expect((await detalheDoAcervo(t.id, 'CAT')).pessoas[0]!.comentario).toBe('Voltei.');

    await removerComentario(t.id, 'BEAR');
    await expect(removerComentario(t.id, 'BEAR')).rejects.toThrow(NotFoundError);
  });

  it('comentar não exige ter assistido; filme que não existe e texto longo demais são recusados', async ({
    skip,
  }) => {
    if (!temBanco) skip('sem Postgres');
    const t = await titulo('-lista');
    expect(await definirComentario(t.id, 'BEAR', 'O trailer é ótimo.')).toMatchObject({ texto: 'O trailer é ótimo.' });

    await expect(definirComentario('nao-existe', 'CAT', 'oi')).rejects.toThrow(NotFoundError);
    await expect(definirComentario(t.id, 'CAT', 'x'.repeat(TAMANHO_MAXIMO_DO_COMENTARIO + 1))).rejects.toThrow(
      ValidationError,
    );
  });

  it('o card dos assistidos traz a nota e o comentário de quem tiver um dos dois', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const t = await titulo('-card');
    await registrarQueAssistimos(t.id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT', 'BEAR'] });
    await definirNota(t.id, 'CAT', 8.5);
    await definirComentario(t.id, 'BEAR', 'Só comentei.');

    const { itens } = await listarAssistidos({ q: PREFIXO });
    expect(itens[0]!.opinioes).toEqual([
      { pessoa: 'CAT', nota: 8.5, comentario: null },
      { pessoa: 'BEAR', nota: null, comentario: 'Só comentei.' },
    ]);
  });

  it('"remover do catálogo" leva os comentários, e o desfazer devolve', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const t = await titulo('-remove');
    await registrarQueAssistimos(t.id, { data: '2026-11-01', local: 'CASA', participantes: ['CAT'] });
    await definirComentario(t.id, 'CAT', 'Fica.');

    const { removidoEm, comentarios } = await removerDoCatalogo(t.id);
    expect(comentarios).toBe(1);
    expect((await detalheDoAcervo(t.id, 'CAT')).pessoas[0]!.comentario).toBeNull();

    expect((await restaurarNoCatalogo(t.id, removidoEm)).comentarios).toBe(1);
    expect((await detalheDoAcervo(t.id, 'CAT')).pessoas[0]!.comentario).toBe('Fica.');
  });

  it('o merge leva o comentário e, quando os dois filmes têm um diferente, fica com os dois', async ({ skip }) => {
    if (!temBanco) skip('sem Postgres');
    const origem = await titulo('-merge-origem');
    const destino = await titulo('-merge-destino');
    await definirComentario(origem.id, 'CAT', 'Da origem.');
    await definirComentario(destino.id, 'CAT', 'Do destino.');
    await definirComentario(origem.id, 'BEAR', 'Só na origem.');

    await mergeTitles(origem.id, destino.id);

    const linhas = await prisma.comment.findMany({
      where: { titleId: destino.id },
      orderBy: { pessoa: 'asc' },
      select: { pessoa: true, text: true },
    });
    expect(linhas).toEqual([
      { pessoa: 'CAT', text: 'Do destino.\n\nDa origem.' },
      { pessoa: 'BEAR', text: 'Só na origem.' },
    ]);
  });
});
