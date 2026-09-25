import { Router } from 'express';
import type { Request, Response } from 'express';
import type { TagFacet } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../../shared/error-handler';
import { ValidationError } from '../../shared/errors';
import { perfilDaRequisicao } from '../users/users.middleware';
import {
  adicionarTagManual,
  listarFacetas,
  removerTagManual,
  tagsManuaisDe,
} from './tags.service';

export const tagsRoutes = Router();

/** Os nomes que o §12 dá aos grupos do painel — "manual" aparece como "Suas tags". */
const ROTULOS_DE_GRUPO: Record<TagFacet, string> = {
  sala: 'Sala',
  cinema: 'Cinema',
  audio: 'Áudio',
  manual: 'Suas tags',
};

interface ItemDeFaceta {
  /** `sala:imax` — é isto que vai no `?tag=` de `GET /titles` */
  id: string;
  facet: TagFacet;
  value: string;
  label: string;
  origin: string;
  ownerId: string | null;
  titulos: number;
}

interface GrupoDeFacetas {
  facet: TagFacet;
  rotulo: string;
  itens: ItemDeFaceta[];
}

/**
 * §10: facetas com contagem — é o que o painel de tags desenha, "agrupado por
 * faceta, com contagem por item" (§12).
 *
 * `?emCartaz=1` restringe a contagem ao que está em cartaz: filtrar por uma
 * sala que só existe em filme de dezembro daria uma lista vazia sem explicação.
 */
tagsRoutes.get(
  '/tags',
  asyncHandler(async (req: Request, res: Response) => {
    const apenasEmCartaz = req.query.emCartaz === '1' || req.query.emCartaz === 'true';
    const facetas = await listarFacetas({ apenasEmCartaz });

    const grupos = new Map<TagFacet, GrupoDeFacetas>();

    // a ordem dos grupos é a do enum (sala, cinema, audio, manual), que é a
    // mesma do modelo `mobile-tags.html` — não a alfabética
    for (const faceta of facetas) {
      const grupo = grupos.get(faceta.facet) ?? {
        facet: faceta.facet,
        rotulo: ROTULOS_DE_GRUPO[faceta.facet],
        itens: [],
      };

      grupo.itens.push({
        // o id é qualificado (`sala:imax`) porque é ele que vai no `?tag=` da
        // lista: o slug sozinho não é único entre facetas
        id: `${faceta.facet}:${faceta.value}`,
        facet: faceta.facet,
        value: faceta.value,
        label: faceta.label,
        origin: faceta.origin,
        ownerId: faceta.ownerId,
        titulos: faceta.titulos,
      });

      grupos.set(faceta.facet, grupo);
    }

    res.json({ grupos: [...grupos.values()], total: facetas.length });
  }),
);

// ── Tags manuais (§10, passo 11) ─────────────────────────────

const novaTagSchema = z.object({ tag: z.string().min(1) });

/** Id de rota; `:id` e `:tagId` vêm da URL e podem vir vazios. */
function idDaRota(valor: unknown, nome: string): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new ValidationError(`${nome} ausente ou inválido.`);
  }
  return valor;
}

/**
 * `POST /api/titles/:id/tags` — só tag manual (§10).
 *
 * O dono vem da SESSÃO, nunca do corpo: a tag é de quem escreveu, e deixar o
 * cliente escolher o dono permitiria criar tag no nome do outro perfil.
 */
tagsRoutes.post(
  '/titles/:id/tags',
  asyncHandler(async (req: Request, res: Response) => {
    const corpo = novaTagSchema.safeParse(req.body);
    if (!corpo.success) {
      throw new ValidationError('Informe o texto da tag.', { details: corpo.error.issues });
    }

    const tag = await adicionarTagManual(
      idDaRota(req.params.id, 'Id do título'),
      perfilDaRequisicao(req),
      corpo.data.tag,
    );

    res.status(201).json(tag);
  }),
);

/** `DELETE /api/titles/:id/tags/:tagId` — só tag manual, e só a sua (§10). */
tagsRoutes.delete(
  '/titles/:id/tags/:tagId',
  asyncHandler(async (req: Request, res: Response) => {
    await removerTagManual(
      idDaRota(req.params.id, 'Id do título'),
      idDaRota(req.params.tagId, 'Id da tag'),
      perfilDaRequisicao(req),
    );

    res.status(204).end();
  }),
);

/** `GET /api/tags/minhas` — o vocabulário de quem está logado, para sugerir. */
tagsRoutes.get(
  '/tags/minhas',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ itens: await tagsManuaisDe(perfilDaRequisicao(req)) });
  }),
);
