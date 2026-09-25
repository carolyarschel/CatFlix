import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import { perfilDaRequisicao } from '../users/users.middleware';
import { detalheDoTitulo, listarTitulos, montarHome } from './catalog.queries';
import type { TagFiltrada } from './catalog.queries';

const disponibilidades = z.enum(['em_cartaz', 'pre_estreia', 'em_breve']);
const estadosDeUsuario = z.enum(['quero_ver', 'marcado', 'visto']);

/** Hero + trilhas, já agrupados (§10). O perfil vem da sessão (§3). */
export async function getHome(req: Request, res: Response): Promise<void> {
  res.json(await montarHome(perfilDaRequisicao(req)));
}

const facetas = z.enum(['sala', 'cinema', 'audio', 'manual']);

/**
 * Aceita `?tag=imax&tag=legendado`, `?tag=imax,legendado` e a forma
 * qualificada `?tag=sala:imax`, que é a que o painel de tags manda.
 *
 * O slug sozinho continua valendo — é o formato que já estava documentado no
 * README. Qualificar é o que impede uma tag manual homônima de alargar o
 * filtro sem ninguém perceber (ver `TagFiltrada`).
 *
 * Faceta desconhecida é erro, não é ignorada: `?tag=sla:imax` que virasse
 * "imax em qualquer faceta" seria exatamente o silêncio que isto evita.
 */
function tagsDe(req: Request): TagFiltrada[] {
  const bruto = req.query.tag;
  const lista = Array.isArray(bruto) ? bruto : bruto === undefined ? [] : [bruto];

  return lista
    .filter((t): t is string => typeof t === 'string')
    .flatMap((t) => t.split(','))
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      const separador = t.indexOf(':');
      if (separador < 0) return { value: t };

      const faceta = facetas.safeParse(t.slice(0, separador));
      if (!faceta.success) {
        throw new ValidationError(`Faceta de tag desconhecida em "${t}".`, {
          details: { validas: facetas.options },
        });
      }

      const value = t.slice(separador + 1).trim();
      if (value.length === 0) {
        throw new ValidationError(`Tag "${t}" veio sem valor depois da faceta.`);
      }

      return { facet: faceta.data, value };
    });
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}

export async function getTitles(req: Request, res: Response): Promise<void> {
  const availability = texto(req.query.availability);
  const status = texto(req.query.status);

  const disponibilidade = availability ? disponibilidades.safeParse(availability) : null;
  if (disponibilidade && !disponibilidade.success) {
    throw new ValidationError(`Disponibilidade desconhecida: "${availability}".`, {
      details: { validas: disponibilidades.options },
    });
  }

  const estado = status ? estadosDeUsuario.safeParse(status) : null;
  if (estado && !estado.success) {
    throw new ValidationError(`Estado desconhecido: "${status}".`, {
      details: { validos: estadosDeUsuario.options },
    });
  }

  const itens = await listarTitulos({
    availability: disponibilidade?.success ? disponibilidade.data : undefined,
    tags: tagsDe(req),
    cinema: texto(req.query.cinema),
    user: texto(req.query.user) ? perfilDaRequisicao(req) : undefined,
    status: estado?.success ? estado.data : undefined,
    q: texto(req.query.q) ?? texto(req.query.busca),
  });

  res.json({ itens, total: itens.length });
}

export async function getTitle(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('Id do título ausente ou inválido.');
  }

  res.json(await detalheDoTitulo(id));
}
