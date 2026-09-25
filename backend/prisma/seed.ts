import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Os dois perfis fixos (§6). O seed é idempotente: rodar de novo não duplica
 * nem sobrescreve o que já existe além das cores.
 *
 * A paleta completa (--accent-soft, --accent-text) vive no `_tokens.scss` do
 * frontend; aqui fica só a identidade do perfil.
 */
const PERFIS = [
  {
    id: 'catflix',
    displayName: 'CatFlix',
    initial: 'C',
    accent: '#FF4D8D',
    accentSecondary: null,
  },
  {
    id: 'hburso',
    displayName: 'HBUrso',
    initial: 'H',
    accent: '#9D7BFF',
    accentSecondary: '#FF8A3D',
  },
] as const;

async function main(): Promise<void> {
  for (const perfil of PERFIS) {
    await prisma.user.upsert({
      where: { id: perfil.id },
      update: {
        displayName: perfil.displayName,
        initial: perfil.initial,
        accent: perfil.accent,
        accentSecondary: perfil.accentSecondary,
      },
      create: {
        id: perfil.id,
        displayName: perfil.displayName,
        initial: perfil.initial,
        accent: perfil.accent,
        accentSecondary: perfil.accentSecondary,
      },
    });
    console.log(`perfil garantido: ${perfil.displayName}`);
  }
}

main()
  .catch((erro: unknown) => {
    console.error('seed falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
