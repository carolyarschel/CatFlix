import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { env, isProduction, senhaDoPerfil } from '../../config/env';
import { logger } from '../../shared/logger';

const log = logger.child({ module: 'auth' });

/**
 * Sessão dos dois perfis (§3, resolvido em 23/09/2026).
 *
 * Decisão: **cookie assinado, httpOnly**, e não JWT no `localStorage`.
 *
 * - O app roda como PWA no celular dos dois. Token em `localStorage` é legível
 *   por qualquer script que entre na página; cookie `httpOnly` não é.
 * - Não há terceiro consumindo a API, então não há nada que um JWT resolvesse
 *   e um cookie não.
 * - Zero dependência nova: HMAC-SHA256 do `node:crypto`.
 *
 * Se um dia o Crônicas de Gatur (§14) quiser sessão compartilhada, o que muda é
 * este arquivo — `exigirPerfil` e o resto do app não sabem como a sessão é
 * guardada. Era essa a razão de o §3 pedir um middleware isolado.
 */

export const NOME_DO_COOKIE = 'filmes_sessao';

/**
 * Segredo de assinatura. Sem `AUTH_SECRET`, gera um por processo: em
 * desenvolvimento isso deixa o login funcionar sem configurar nada, ao custo de
 * derrubar as sessões a cada reinício — que é o aviso de que falta configurar.
 */
const segredo = (() => {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;

  if (isProduction) {
    throw new Error(
      'AUTH_SECRET é obrigatória em produção: sem ela, reiniciar o servidor desloga os dois.',
    );
  }

  log.warn('AUTH_SECRET não configurada — usando segredo efêmero; a sessão cai a cada reinício');
  return randomBytes(32).toString('hex');
})();

const DURACAO_MS = env.AUTH_SESSION_DAYS * 86_400_000;

function assinar(carga: string): string {
  return createHmac('sha256', segredo).update(carga).digest('base64url');
}

/** `perfil.expiraEm.assinatura` — legível o bastante para depurar, inforjável. */
export function criarToken(perfil: string): string {
  const carga = `${perfil}.${Date.now() + DURACAO_MS}`;
  return `${carga}.${assinar(carga)}`;
}

/**
 * Devolve o perfil se o token for válido e não estiver vencido; `null` caso
 * contrário. Nunca lança: token inválido é rotina (cookie velho, segredo
 * trocado), não excepcional.
 */
export function lerToken(token: string | undefined): string | null {
  if (!token) return null;

  const partes = token.split('.');
  if (partes.length !== 3) return null;

  const [perfil, expiraEm, assinatura] = partes as [string, string, string];
  const esperada = assinar(`${perfil}.${expiraEm}`);

  if (!comparacaoSegura(assinatura, esperada)) return null;
  if (!Number(expiraEm) || Number(expiraEm) < Date.now()) return null;

  return perfil;
}

/**
 * Compara sem vazar pelo tempo. Compara os DIGESTS, não as strings: assim o
 * tamanho das entradas também não vaza, e `timingSafeEqual` nunca recebe
 * buffers de tamanhos diferentes (o que faria ele lançar).
 */
function comparacaoSegura(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/** A senha confere? `false` também quando o perfil não tem senha configurada. */
export function senhaConfere(perfil: string, senha: string): boolean {
  const esperada = senhaDoPerfil(perfil);
  if (!esperada) {
    log.warn('tentativa de login em perfil sem senha configurada', { perfil });
    return false;
  }

  return comparacaoSegura(senha, esperada);
}

export function opcoesDoCookie(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    // `lax` e não `strict`: com `strict`, abrir o PWA por um link externo
    // mostraria a tela de login mesmo com sessão válida.
    sameSite: 'lax',
    secure: isProduction,
    maxAge: DURACAO_MS,
    path: '/',
  };
}

/**
 * Lê um cookie do cabeçalho. Escrito à mão para não acrescentar dependência por
 * seis linhas — o backend inteiro tem uma lista curta de dependências de
 * propósito.
 */
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined;

  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;

    if (parte.slice(0, separador).trim() === nome) {
      return decodeURIComponent(parte.slice(separador + 1).trim());
    }
  }

  return undefined;
}
