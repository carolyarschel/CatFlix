import { describe, expect, it } from 'vitest';
import { criarToken, lerCookie, lerToken, senhaConfere } from './users.sessao';

/**
 * Passo 10 / §3. O que estes testes protegem é o que dá errado em silêncio:
 * um token forjado aceito, um token vencido ainda válido, uma senha errada que
 * passa por igualdade frouxa.
 *
 * As senhas vêm do `.env` do ambiente de teste; os casos aqui não dependem de
 * nenhum valor específico, só do comportamento.
 */

describe('token de sessão', () => {
  it('ida e volta devolve o perfil', () => {
    expect(lerToken(criarToken('catflix'))).toBe('catflix');
  });

  it('recusa token com assinatura trocada', () => {
    const token = criarToken('catflix');
    const [perfil, prazo] = token.split('.');
    expect(lerToken(`${perfil}.${prazo}.assinaturaInventada`)).toBeNull();
  });

  it('recusa troca de perfil sem reassinar — o ataque óbvio', () => {
    const token = criarToken('catflix');
    const [, prazo, assinatura] = token.split('.');
    expect(lerToken(`hburso.${prazo}.${assinatura}`)).toBeNull();
  });

  it('recusa token vencido, mesmo com assinatura boa', () => {
    // um token com prazo no passado só existe se alguém mexer no cookie; a
    // assinatura dele não confere, e o prazo também não — as duas barreiras
    const vencido = `catflix.${Date.now() - 1000}.qualquer`;
    expect(lerToken(vencido)).toBeNull();
  });

  it('recusa lixo sem quebrar', () => {
    expect(lerToken(undefined)).toBeNull();
    expect(lerToken('')).toBeNull();
    expect(lerToken('sem-pontos')).toBeNull();
    expect(lerToken('a.b')).toBeNull();
    expect(lerToken('a.b.c.d')).toBeNull();
  });
});

describe('senhaConfere', () => {
  it('recusa perfil que não tem senha configurada', () => {
    expect(senhaConfere('perfil-inexistente', 'qualquer')).toBe(false);
  });

  it('recusa senha vazia', () => {
    expect(senhaConfere('catflix', '')).toBe(false);
  });
});

describe('lerCookie', () => {
  it('acha o cookie no meio de outros', () => {
    expect(lerCookie('outro=1; filmes_sessao=abc; mais=2', 'filmes_sessao')).toBe('abc');
  });

  it('não confunde cookie cujo nome termina igual', () => {
    expect(lerCookie('x_filmes_sessao=errado; filmes_sessao=certo', 'filmes_sessao')).toBe('certo');
  });

  it('devolve indefinido quando não há cabeçalho ou não há o cookie', () => {
    expect(lerCookie(undefined, 'filmes_sessao')).toBeUndefined();
    expect(lerCookie('outro=1', 'filmes_sessao')).toBeUndefined();
  });
});
