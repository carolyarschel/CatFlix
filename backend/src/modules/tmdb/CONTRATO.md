# Contrato do TMDB

Levantado em **22/09/2026** por sondagem ao vivo, contra a documentação oficial
da API v3.

Fonte de toda a metadata do catálogo (§5.2 do contexto) e da chave canônica do
projeto, o `tmdb_id`.

---

## 1. Base

| Item | Valor |
|---|---|
| Base | `https://api.themoviedb.org/3` |
| Autenticação | `api_key` na **query string** (chave v3) |
| Idioma | `language=pt-BR` em toda chamada |
| Imagens | `https://image.tmdb.org/t/p/{tamanho}{caminho}` |

A chave vai na URL, então passa por `shared/redact` antes de virar
`RawPayload.params` ou log.

Esta é, das três fontes, a **mais estável e a melhor documentada**. Ainda assim
o fluxo é o mesmo: bruto primeiro, zod depois, payload que não bate não atualiza
nada.

---

## 2. Endpoints que usamos

### 2.1 Busca

```
GET /search/movie?query=&language=pt-BR&primary_release_year=&include_adult=false
```

Busca sem resultado devolve `total_results: 0` e `results: []`, com **HTTP 200**.
É ausência, não erro — quem decide o que fazer é o matching.

### 2.2 Detalhe

```
GET /movie/{id}?language=pt-BR&append_to_response=credits,external_ids,release_dates
```

Campos usados:

| Campo | Destino |
|---|---|
| `id` | `TitleExternalId(tmdb)` — **a chave canônica** |
| `title` / `original_title` | `Title.title` / `Title.originalTitle` |
| `runtime` | `Title.runtimeMinutes` — vem `0` em filme não lançado, tratado como `null` |
| `release_date` | `Title.releaseDate` e `Title.year` |
| `overview` | `Title.overview` |
| `poster_path` / `backdrop_path` | URL absoluta com `w500` / `w1280` |
| `genres[]` | `Genre` + `TitleGenre` |
| `production_companies[]` | `Company` + `TitleCompany` |
| `credits.crew[job="Director"]` | `TitleCredit(director)` |
| `credits.cast[]` | `TitleCredit(cast)`, primeiros 12 por `order` |
| `external_ids.imdb_id` | ponte para o OMDb |
| `external_ids.tvdb_id` | previsto para o Sonarr (§13) |

---

## 3. Erros

Ao contrário do OMDb, o TMDB usa status HTTP corretamente, e o corpo do erro é
estruturado:

| Situação | HTTP | `status_code` |
|---|---|---|
| id inexistente | 404 | 34 |
| chave inválida | 401 | 7 |

O client aproveita `status_message` na mensagem do `ExternalApiError`, em vez de
despejar HTML.

---

## 4. ⚠️ Os "não-filmes" existem no TMDB — e casam bem

Descoberta que muda o passo 5. Os eventos que a triagem do ingresso marca como
suspeitos **têm entrada no TMDB**, com título e ano batendo:

| Título do ingresso | TMDB | Gêneros |
|---|---|---|
| Rammstein - Live In Mexico City | 1753205, dir. Paul Dugdale | **Documentário, Música** |
| Queen Rock Montreal | encontrado | — |
| BTS World Tour | 21 resultados | — |
| Maiara e Maraisa | encontrado | — |

**Sem a triagem, o matching aceitaria todos com confiança alta** e eles virariam
filme comum na home da Carol, no meio de *Duna* e *A Odisseia*.

Em compensação, o TMDB oferece o **melhor sinal de triagem disponível**: o
gênero. *Rammstein* é `[Documentário, Música]`; *Duna: Parte Dois* é
`[Ficção científica, Aventura]`. Está em `config/title-suffixes.json` como
`eventGenresTmdb`.

Ressalva: gênero "Música" sozinho **não condena** — há musical de ficção
(*La La Land*, *Wicked*) que é filme legítimo. Soma ao score de suspeita e vai
para revisão, nunca descarta sozinho.

---

## 5. Caso curioso: TMDB conhece, OMDb não

*Rammstein - Live in Mexico City* tem `imdb_id: tt46000907` no TMDB, mas o OMDb
responde `Incorrect IMDb ID.` para ele.

Não é erro: o OMDb tem seu próprio recorte do IMDb e demora a incluir
lançamentos. O fluxo trata isso como ausência — o filme fica no catálogo com
metadata completa e **sem nota**, que é exatamente o que a §5.3 manda.
