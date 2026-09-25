/**
 * Redação de segredos.
 *
 * O TMDB e o OMDb autenticam por **query string** (`api_key=`, `apikey=`), o
 * que significa que a credencial vive na URL e nos parâmetros — justamente o
 * que acaba em log de erro, em `RawPayload.params` e em detalhe de canary.
 * Sem isto, as chaves da Carol ficariam em texto puro no Postgres, replicadas
 * em cada linha, e sairiam em qualquer dump.
 *
 * Sem dependência nenhuma de propósito: tanto o cliente HTTP quanto a camada
 * de persistência usam isto, e nenhum dos dois deve puxar o outro.
 */

const PARAMETROS_SECRETOS = new Set([
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
  'secret',
  'password',
]);

export const MARCADOR = '[redigido]';

export function ehParametroSecreto(chave: string): boolean {
  return PARAMETROS_SECRETOS.has(chave.toLowerCase());
}

export function redigirParametros(params: Record<string, string>): Record<string, string> {
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(params)) {
    limpo[chave] = ehParametroSecreto(chave) ? MARCADOR : valor;
  }
  return limpo;
}

export function redigirUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const chave of [...parsed.searchParams.keys()]) {
      if (ehParametroSecreto(chave)) parsed.searchParams.set(chave, MARCADOR);
    }
    return parsed.toString();
  } catch {
    // URL não parseável: melhor devolver como veio do que engolir a informação
    return url;
  }
}
