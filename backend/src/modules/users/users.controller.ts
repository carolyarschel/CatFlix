import type { Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { NaoAutenticadoError } from './users.middleware';
import { NOME_DO_COOKIE, criarToken, opcoesDoCookie, senhaConfere } from './users.sessao';
import { buscarPerfil, listarPerfis } from './users.service';

const log = logger.child({ module: 'auth' });

/**
 * Login com seletor de perfil e senha do `.env` (§3, resolvido em 23/09/2026).
 */

const corpoDeLogin = z.object({
  perfil: z.string().min(1),
  senha: z.string().min(1),
});

/**
 * Freio de força bruta, em memória.
 *
 * São dois perfis e duas pessoas: uma tabela no banco e um algoritmo esperto
 * seriam desproporcionais. O que isto impede é o caso real — alguém achar a URL
 * e deixar um script tentando senhas a noite inteira. Reiniciar o backend zera
 * a contagem, e tudo bem: quem reinicia o backend é quem já tem a máquina.
 */
const TENTATIVAS_ATE_FREAR = 5;
const ESPERA_BASE_MS = 2_000;
const ESPERA_MAXIMA_MS = 60_000;

const falhas = new Map<string, { quantas: number; liberaEm: number }>();

function esperaAtual(perfil: string): number {
  const registro = falhas.get(perfil);
  if (!registro || registro.quantas < TENTATIVAS_ATE_FREAR) return 0;
  return Math.max(0, registro.liberaEm - Date.now());
}

function registrarFalha(perfil: string): void {
  const registro = falhas.get(perfil) ?? { quantas: 0, liberaEm: 0 };
  registro.quantas += 1;

  if (registro.quantas >= TENTATIVAS_ATE_FREAR) {
    const excedente = registro.quantas - TENTATIVAS_ATE_FREAR;
    const espera = Math.min(ESPERA_BASE_MS * 2 ** excedente, ESPERA_MAXIMA_MS);
    registro.liberaEm = Date.now() + espera;
  }

  falhas.set(perfil, registro);
}

export async function postLogin(req: Request, res: Response): Promise<void> {
  const corpo = corpoDeLogin.safeParse(req.body);
  if (!corpo.success) {
    throw new ValidationError('Informe o perfil e a senha.', { details: corpo.error.issues });
  }

  const { perfil, senha } = corpo.data;

  const espera = esperaAtual(perfil);
  if (espera > 0) {
    throw new NaoAutenticadoError(
      `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 1000)} segundos.`,
    );
  }

  // o perfil precisa existir no banco: senha certa de um perfil inexistente
  // não pode virar sessão de ninguém
  const existe = await listarPerfis();
  if (!existe.some((p) => p.id === perfil)) {
    registrarFalha(perfil);
    throw new NaoAutenticadoError('Perfil ou senha não conferem.');
  }

  if (!senhaConfere(perfil, senha)) {
    registrarFalha(perfil);
    log.warn('login recusado', { perfil });
    // a mesma mensagem dos dois lados: dizer "senha errada" confirmaria que o
    // perfil existe, e são dois nomes fáceis de adivinhar
    throw new NaoAutenticadoError('Perfil ou senha não conferem.');
  }

  falhas.delete(perfil);
  res.cookie(NOME_DO_COOKIE, criarToken(perfil), opcoesDoCookie());

  log.info('login', { perfil });
  res.json({ perfil: await buscarPerfil(perfil) });
}

export function postLogout(_req: Request, res: Response): void {
  res.clearCookie(NOME_DO_COOKIE, { ...opcoesDoCookie(), maxAge: undefined });
  res.json({ ok: true });
}

/**
 * Estado da sessão + a lista de perfis.
 *
 * Rota **pública**, e devolve 200 mesmo deslogada: é ela que desenha a tela de
 * login, que precisa saber o nome e a cor de acento de cada perfil antes de
 * alguém entrar. Nenhum dado de catálogo sai daqui.
 */
export async function getSessao(req: Request, res: Response): Promise<void> {
  res.json({
    perfil: req.perfil ? await buscarPerfil(req.perfil) : null,
    perfis: await listarPerfis(),
  });
}
