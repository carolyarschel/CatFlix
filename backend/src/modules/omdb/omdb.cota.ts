import { prisma } from '../../shared/prisma';

/**
 * Cota diária do OMDb (cineon-expansao §5.3: "o job precisa respeitar uma
 * cota diária configurável").
 *
 * Conta as chamadas das últimas 24 horas pelos `RawPayload` do OMDb: toda
 * chamada fica gravada ali antes de qualquer parsing (§7.1), inclusive as que
 * falharam — e falha também gasta cota. Janela móvel, e não "desde a meia-noite",
 * porque não sabemos a que horas (nem em que fuso) o OMDb zera o contador: uma
 * janela de 24 h nunca passa do limite, seja qual for o relógio dele.
 */
export async function cotaDoOmdb(
  limite: number,
  agora = new Date(),
): Promise<{ usadas: number; restante: number }> {
  const usadas = await prisma.rawPayload.count({
    where: { source: 'omdb', fetchedAt: { gte: new Date(agora.getTime() - 24 * 3_600_000) } },
  });
  return { usadas, restante: Math.max(0, limite - usadas) };
}
