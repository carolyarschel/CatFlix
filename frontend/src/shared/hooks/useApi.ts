import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';

/**
 * Busca de leitura com os três estados que toda tela precisa tratar:
 * carregando, erro e dado.
 *
 * O **modo degradado do §8 não mora aqui**: "dados de X horas atrás" é dado que
 * chegou, não erro. Este hook só distingue "o backend respondeu" de "não
 * respondeu"; quem lê a idade do dado é a tela.
 */

/**
 * O que cabe numa query string daqui. A lista existe para o filtro de tags:
 * `GET /titles` aceita `?tag=` repetido, e o cliente já sabia montar isso.
 */
export type ValoresDeQuery = Record<string, string | number | undefined | string[]>;

export interface EstadoDaBusca<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

export function useApi<T>(
  caminho: string,
  opcoes: { query?: ValoresDeQuery; ativo?: boolean } = {},
): EstadoDaBusca<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  // a query é um objeto novo a cada render; comparar pelo conteúdo evita um
  // laço infinito de efeito → setState → efeito
  const chaveDaQuery = JSON.stringify(opcoes.query ?? {});
  const ativo = opcoes.ativo ?? true;

  const queryRef = useRef(opcoes.query);
  queryRef.current = opcoes.query;

  useEffect(() => {
    if (!ativo) return;

    const controller = new AbortController();
    setCarregando(true);

    api
      .get<T>(caminho, { query: queryRef.current, signal: controller.signal })
      .then((resposta) => {
        if (controller.signal.aborted) return;
        setDados(resposta);
        setErro(null);
      })
      .catch((problema: unknown) => {
        if (controller.signal.aborted) return;
        setErro(
          problema instanceof ApiError ? problema.message : 'Não consegui falar com o servidor.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });

    return () => controller.abort();
  }, [caminho, chaveDaQuery, ativo, gatilho]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  return { dados, carregando, erro, recarregar };
}
