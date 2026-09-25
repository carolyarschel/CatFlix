# Contrato do OMDb

Levantado em **22/09/2026** por sondagem ao vivo. O OMDb não publica OpenAPI.

Fonte das notas IMDb e Rotten Tomatoes (§5.3 do contexto).

---

## 1. Base

| Item | Valor |
|---|---|
| Base | `https://www.omdbapi.com/` |
| Autenticação | `apikey` na **query string** |
| Método | `GET` |
| Cota | 1.000 requisições/dia no tier grátis |
| Busca | **sempre por `imdb_id`** (`?i=tt...`), nunca por título |

A chave vai na URL, então ela passa por `shared/redact` antes de virar
`RawPayload.params`, log ou detalhe de erro. Nenhuma linha do banco tem a chave
em texto puro — verificado por consulta.

---

## 2. ⚠️ HTTP 200 não significa sucesso

**A armadilha central desta API.** O OMDb responde `200 OK` quando não encontra
o filme, e sinaliza o erro **no corpo**:

```json
{ "Response": "False", "Error": "Incorrect IMDb ID." }
```

Quem confia no status HTTP grava nota errada ou explode no parse. Por isso o
schema `zod` é uma **união discriminada por `Response`**, não por status — o
tipo do TypeScript força o tratamento dos dois casos.

Medido:

| Caso | HTTP | `Response` | `Error` |
|---|---|---|---|
| imdb_id válido | 200 | `True` | — |
| imdb_id inexistente | 200 | `False` | `Incorrect IMDb ID.` |
| imdb_id malformado | 200 | `False` | `Incorrect IMDb ID.` |
| sem o parâmetro `i` | 200 | `False` | `Incorrect IMDb ID.` |
| **chave inválida** | **401** | `False` | `Invalid API key!` |

Só a chave inválida usa status HTTP. Faz sentido para nós: é problema de
configuração, e precisa ser alto. `Response: "False"` é ausência de dado, e vira
`{ tipo: 'nao_encontrado' }` — o filme segue no catálogo, só sem nota.

---

## 3. ⚠️ `"N/A"` é string, não `null`

Nota ausente não vem `null` nem some do corpo: vem a **string `"N/A"`**.
`Number.parseFloat('N/A')` é `NaN`, e `NaN` gravado no banco é nota inventada.

Medido em 10 lançamentos futuros: **3 vieram `imdbRating: "N/A"`**.

Formatos dentro de `Ratings[]`, que variam por fonte:

```json
"Ratings": [
  { "Source": "Internet Movie Database", "Value": "8.4/10" },
  { "Source": "Rotten Tomatoes",         "Value": "92%"    },
  { "Source": "Metacritic",              "Value": "79/100" }
]
```

Usamos `imdbRating` (campo de topo) e o item de `Ratings` cuja `Source` é
exatamente `"Rotten Tomatoes"`.

**`Ratings` pode não trazer Rotten Tomatoes nenhum** — comum em filme
brasileiro e em qualquer lançamento recente. Medido: 5 de 10 lançamentos
futuros sem RT.

Ambas as notas são nullable no `Title`, e ausência **nunca** quebra o fluxo.

---

## 4. ⚠️ User-Agent tem de ser ASCII

O OMDb está atrás de um WAF que devolve **403 com página HTML** quando o
`User-Agent` tem caractere não-ASCII. Determinístico: 5 tentativas com acento →
5× 403; 5 sem acento → 5× 200.

Está corrigido na raiz (o schema de ambiente recusa o boot com acento no
`INGRESSO_USER_AGENT`), mas fica registrado porque o sintoma engana: parece a
API fora do ar.

Ver `modules/ingresso/CONTRATO.md` §2.1 — o mesmo cabeçalho provavelmente
causava `400` intermitente no ingresso.

---

## 5. Cadência de consulta

Da §5.3 do contexto: **diária na primeira semana após a estreia, semanal
depois.** Implementado em `precisaAtualizarNotas`, que precisa do
`Title.releaseDate` para saber em qual regime o filme está — foi por isso que
esse campo entrou no schema (não estava no modelo conceitual da §6).

Sem data de estreia, usa a cadência conservadora (semanal).

**Nunca chamar durante requisição de usuário.** Só em job.

Com 1.000 requisições/dia e ~40 filmes em cartaz em Campinas, a cota é
folgada — mas a consulta é por `imdb_id`, então filme sem `imdb_id` no TMDB
nunca chega aqui.
