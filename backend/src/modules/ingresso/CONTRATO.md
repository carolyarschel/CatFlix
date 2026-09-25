# Contrato da API do ingresso.com

Levantado em **22/09/2026** por leitura do OpenAPI publicado + sondagem ao vivo
(São Paulo e Campinas, ~45 requisições sequenciais com User-Agent honesto).

Reconferir este documento quando um canary de contrato disparar.

---

## 0. Correção de premissa do `contexto.md`

A §2 do contexto diz que o ingresso.com "não tem API pública oficial" e que
usaríamos "a API interna exposta pelo próprio site". **Isso está desatualizado:**
a API publica um OpenAPI 3.0.4 navegável.

- Swagger UI: `https://api-content.ingresso.com/swagger/index.html`
- Spec v0 (a real, 36 endpoints): `https://api-content.ingresso.com/swagger/v0/swagger.json`
- Spec v1: existe, mas `paths` está **vazio** — só declara esquemas de auth
  (Bearer JWT e header `X-User`). Não usar.

**O que isso muda:** temos os nomes dos campos e os tipos sem adivinhação.

**O que isso NÃO muda:** continua sem contrato de uso, sem versionamento
prometido, sem limite de taxa documentado e sem autenticação. E, como a §7
mostra, **o spec mente em pelo menos um ponto importante**. Toda a arquitetura
defensiva do projeto (RawPayload antes do parsing, cache no Postgres, canaries,
modo degradado) segue necessária. O spec é um mapa melhor, não uma garantia.

---

## 1. Base e política de acesso

| Item | Valor |
|---|---|
| Base | `https://api-content.ingresso.com/v0` |
| Autenticação | **nenhuma** |
| Método | só `GET` |
| Latência observada | 80 ms a 400 ms |
| Rate limit | não documentado; nenhum `429` observado. Cuidado com o `400` vazio — ver §2.1 |

Regras que o nosso cliente aplica (§5.1 do contexto): User-Agent honesto e fixo,
concorrência máxima 4, backoff exponencial, respeitar `Retry-After`, nunca
chamar do navegador.

---

## 2. ⚠️ O parâmetro `partnership`

Todo endpoint de conteúdo exige `partnership` no caminho. **O spec não diz quais
valores são válidos nem o que o parâmetro faz.** Sondagem na cidade 1:

| `partnership` | theaters | nowplaying | premiere | soon |
|---|---|---|---|---|
| `www` | 49 | 104 | 14 | 161 |
| `app` | 49 | 104 | 14 | 161 |
| `zzzznaoexiste` (inválido) | 49 | 104 | 14 | 161 |
| `home` | 49 (mas ver §3) | 104 | 14 | 161 |
| `ingresso` | **0** | 43 | 9 | — |
| `cinemark` | 23 | 44 | 9 | — |

Leitura:

- **Um valor não reconhecido não dá erro: cai num padrão** que devolve o
  catálogo completo, de todas as redes. É o que queremos.
- `ingresso` e `cinemark` **filtram** para o que aquele parceiro vende.
  `ingresso` é inconsistente: devolve 43 filmes mas **zero cinemas**, o que o
  torna inutilizável para o nosso sync.
- `home` é o valor mais citado pela comunidade e **é o pior dos dois mundos**:
  tem o mesmo resultado do padrão, mas cai num caminho de código que devolve
  UTF-16 (§3).

**Decisão: usar `www`.** Dá o catálogo completo, devolve UTF-8 e é o valor que
aparece nas URLs que a própria API monta em `siteURL`. Fica em
`INGRESSO_PARTNERSHIP`, não hardcoded, porque é um palpite informado sobre um
parâmetro não documentado.

**Canary:** se `theaters` passar a devolver 0, ou `nowplaying` despencar para ~43,
é sinal de que o valor deixou de ser aceito — cai no canary semântico (§8).

---

## 2.1 ⚠️ `400` com corpo vazio — e o User-Agent não-ASCII

Durante a sondagem apareceram **`400 Bad Request` com corpo de zero bytes** em
URLs que funcionavam um minuto depois. Nunca um `429`, nunca um `Retry-After`.

**Primeiro diagnóstico (22/09, errado): "a API sinaliza throttle com 400".**
Corrigido no mesmo dia, ao implementar o módulo OMDb.

**Causa provável: cabeçalho `User-Agent` com caractere não-ASCII.** O valor
padrão trazia "responsável"/"instância", e valor de cabeçalho HTTP tem de ser
ASCII (RFC 9110 §5.5). Medições:

| | com acento | só ASCII |
|---|---|---|
| OMDb, 5 tentativas | **403 · 403 · 403 · 403 · 403** (HTML de WAF) | 200 · 200 · 200 · 200 · 200 |
| ingresso, 1ª rodada de 7 | 3 falhas `400` | 0 falhas |
| ingresso, 40 requisições depois | 0 falhas | 0 falhas |

No **OMDb a relação é determinística e comprovada**. No **ingresso é só
indício**: a falha apareceu duas vezes com o acento e nunca sem ele, mas não
reproduziu em 40 requisições seguidas. Pode ser flutuação do WAF diante do
cabeçalho malformado, pode ser outra coisa.

Corrigido na raiz: o `INGRESSO_USER_AGENT` agora é ASCII e o schema de ambiente
**recusa o boot** se alguém puser um acento ali de novo. Era um erro que não se
anunciava — o cabeçalho sai, a requisição parece normal, e o bloqueio parece
problema da API.

O que fica, independentemente da causa:

1. **`HttpClient` com `retryEmpty400: true`** (ligado só para o ingresso) repete
   `400` + corpo vazio com backoff. Mantido como seguro contra flutuação de WAF,
   que não controlamos — mas **não** porque a API tenha rate limit documentado.
   Um `400` **com** corpo continua sendo erro do nosso pedido e não é repetido.
2. **A ordem das checagens no client.** Este bug era real e independe da causa:
   como o `204` de cinema sem sessão (§4.3) também tem corpo vazio, checar
   "corpo vazio" antes do status transformava qualquer `400` em "este cinema não
   tem sessão nenhuma" — e o sync marcaria a grade inteira como sumida, em
   silêncio. Agora o status vem primeiro. Coberto por teste.

**Lição para os canaries:** antes de culpar a API, conferir o que **nós**
mandamos. Um `400` vazio é sinal de transporte; se virar persistente, é bloqueio.

---

## 3. ⚠️ Charset: algumas respostas vêm em UTF-16

`GET /v0/theaters/city/1/partnership/home` responde
`Content-Type: application/json; charset=utf-16`. Os demais endpoints observados
respondem `charset=utf-8`.

Isto **quebra `response.text()` do fetch**, que decodifica sempre como UTF-8 e
ignora o charset declarado. O resultado é lixo que falha no `JSON.parse` — ou
seja, um "contrato quebrado" falso, que dispararia canary sem haver mudança
nenhuma na API.

Já corrigido em `shared/http/http-client.ts`: o corpo é lido como `arrayBuffer` e
decodificado com o charset do cabeçalho. Coberto por teste de regressão em
`http-client.test.ts`.

---

## 4. Endpoints que usamos

### 4.1 Cidades e fusos

```
GET /v0/states
```

Sem parâmetros, sem `partnership`. Devolve **array** de 27 estados, 199 cidades.

```json
[{ "name": "Acre", "uf": "AC",
   "cities": [{ "id": "364", "name": "Rio Branco", "uf": "AC",
                "state": "Acre", "urlKey": "rio-branco",
                "timeZone": "America/Rio_Branco" }] }]
```

**Campos usados:** `cities[].id` (→ `INGRESSO_CITY_ID`), `name`, `timeZone`
(→ `Cinema.timezone`), `urlKey`.

### 4.2 Cinemas da cidade

```
GET /v0/theaters/city/{cityId}/partnership/{partnership}
```

Envelope `{ items: [...], count: n }`.

**Campos usados:** `id` → `Cinema.ingressoId` · `name` · `corporation` →
`Cinema.chain` · `address`, `number`, `neighborhood` → `Cinema.address` ·
`cityId`, `cityName` · `urlKey` · `totalRooms` · `enabled`.

### 4.3 Sessões de um cinema — **o endpoint central**

```
GET /v0/sessions/city/{cityId}/theater/{theaterId}/partnership/{partnership}
    [?date=YYYY-MM-DD]
```

⚠️ **O spec está errado aqui.** Ele declara a resposta como um objeto
`ShowtimeByTheaterViewObject`. Na prática é um **array** desses objetos, um por
dia — 29 a 34 dias na amostra. Os schemas `zod` seguem o observado, não o spec.

⚠️ **Cinema sem sessão responde `204 No Content` com corpo vazio**, não `200`
com `[]`. Observado no teatro 1587 (Campinas). `JSON.parse('')` lança, então um
cinema em reforma dispararia canary de contrato sem haver mudança nenhuma.
Tratar 204 e corpo vazio como "zero dias" antes de validar com zod.

Estrutura: `dia[] → movies[] → rooms[] → sessions[]`

```json
[{ "date": "2026-09-22", "dateFormatted": "22/09",
   "dayOfWeek": "terça-feira", "isToday": true,
   "movies": [{
     "id": "28462", "type": "Filme",
     "title": "Authentic Games No Império Desconectado",
     "originalTitle": "Authentic Games No Império Desconectado",
     "duration": "71", "releaseYear": 2026,
     "distributor": "Imagem Filmes",
     "inPreSale": false, "isReexhibition": false,
     "genres": ["Ação", "Animação", "Aventura"],
     "siteURL": "https://www.ingresso.com/filme/...",
     "rooms": [{
       "name": "Sala 1 - LASER", "type": null,
       "sessions": [{
         "id": "87005018", "room": "Sala 1 - LASER",
         "type": ["Laser", "Nacional"],
         "types": [
           { "id": 1073741824, "name": "Laser", "alias": "Laser",
             "typeDescriptions": { "detailedImage": ".../sessiontype/" } },
           { "id": 0, "name": "Nacional", "alias": "NAC",
             "typeDescriptions": { "detailedImage": ".../copytype/" } }],
         "time": "13:10",
         "date": { "localDate": "2026-09-22T13:10:00-03:00", "hour": "13:10" },
         "siteURL": "https://checkout.ingresso.com/?sessionId=87005018&...",
         "price": 47.4, "enabled": true }] }] }] }]
```

**Campos usados:**

| Campo | Destino |
|---|---|
| `sessions[].id` | `Session.ingressoSessionId` |
| `sessions[].date.localDate` | `Session.startsAt` |
| `sessions[].room` / `rooms[].name` | `Session.roomName` |
| `sessions[].types[]` | `Session.roomType`, `audio`, `is3d` (regra na §6) |
| `sessions[].siteURL` | `Session.purchaseUrl` |
| `sessions[].enabled` | sessão bloqueada não vira `Session` ativa |
| `movies[].id` | chave do matching → `TitleExternalId(ingresso)` |
| `movies[].originalTitle` | **match forte** (§7.2, estágio 2) |
| `movies[].duration` | string de minutos; score de duração |
| `movies[].releaseYear` | score de ano |
| `movies[].distributor` | triagem "isso é filme?" — ver §5 |
| `movies[].type` | **inútil para triagem** — ver §5 |
| `movies[].isReexhibition` | contexto para o normalizador |
| `movies[].inPreSale` | `Availability` de pré-estreia |
| `movies[].siteURL` | link do card para o ingresso.com (§1) |

**`localDate` já vem com o offset UTC** (`-03:00`), então converte direto para
`timestamptz` sem precisar aplicar o fuso da cidade à mão. O `timeZone` da cidade
continua útil para agrupar "sessões de quinta" na tela.

**813 sessões amostradas em 8 cinemas: nenhuma sem `id`.** Confirma a escolha de
`Session.ingressoSessionId` como chave única e idempotente do sync.

### 4.4 Listas por cidade

```
GET /v0/templates/nowplaying/{cityId}/partnership/{partnership}?limit=&skip=
GET /v0/templates/premiere/{cityId}/partnership/{partnership}
GET /v0/templates/soon/{cityId}/partnership/{partnership}?limit=
GET /v0/templates/highlights/{cityId}/partnership/{partnership}
```

Envelope `{ items: EventViewObject[], count: n }` → `Availability`
`em_cartaz` / `pre_estreia` / `em_breve`.

⚠️ **`count` NÃO é o total.** É a quantidade devolvida nesta resposta, e **não
existe campo de total**. Com `limit` padrão (10), `count` é 10. Em `soon`:
`limit=100` → `count=100`; `limit=300` → `count=161`. Paginar até `count < limit`;
nunca tratar `count` como tamanho do catálogo — inclusive no canary semântico,
que compara número de eventos com a média móvel.

### 4.5 Detalhe do evento

```
GET /v0/events/{id}/partnership/{partnership}?includeCities=false
```

`EventViewObject` completo: acrescenta `synopsis`, `cast`, `director`,
`directors`, `images[]`, `trailers[]`, `contentRating`, `premiereDate`,
`countryOrigin`, `ancineId`, `isComingSoon`, `isPlaying`.

`director` e `cast` (strings) alimentam o componente "diretor/elenco em comum"
do score (peso 0.1).

### 4.6 Créditos — não confiar

```
GET /v0/events/{id}/credits
```

Devolve `{ "cast": [], "crew": [] }` — **vazio** no evento testado. Não usar como
fonte. Créditos vêm do TMDB (§5.2), como o contexto já previa.

---

## 5. ⚠️ Triagem "isso é filme?" — o que a API NÃO entrega

A §7.2 do contexto prevê dois sinais para a triagem: `type` e "distribuidor
ausente". A sondagem mostra que **os dois falham como estão escritos**.

**`type` é sempre `"Filme"`.** Em 813 sessões de São Paulo e 310 do Kinoplex Dom
Pedro, não apareceu nenhum outro valor. Shows, ópera e transmissões ao vivo são
vendidos como `"Filme"`. O campo não discrimina nada.

**O distribuidor nunca está "ausente": vem a string literal `"Sem Distribuidor"`.**
Uma checagem por `null`/vazio não pega nada.

Exemplos reais no Kinoplex Dom Pedro, todos `type: "Filme"` e com duração longa
(o corte de 40 min também não os pega):

| Título | Distribuidor | Duração |
|---|---|---|
| Ozzy & Black Sabbath - Back To The Beginning | **Sem Distribuidor** | 147 |
| Rammstein - Live In Mexico City | **Sem Distribuidor** | 110 |
| BTS World Tour 'Arirang' In Buenos Aires: Live Viewing | Trafalgar | 195 |
| Queen Budapest | Trafalgar | 97 |
| Always Lalisa | Trafalgar | 100 |
| LINKIN PARK: UNSHATTER | Sato Company | 110 |

Sinais que **de fato** funcionam, em ordem de confiança:

1. `distributor === "Sem Distribuidor"` (literal)
2. **distribuidora especializada em evento**: `Trafalgar` é o caso claro — todo
   o catálogo dela na amostra é show e transmissão. Lista em configuração.
3. palavras-chave no título: `Live Viewing`, `Ao Vivo`, `Tour`, nome de banda
4. duração < 40 min (continua valendo para curtas e programas infantis)

Nenhum sozinho é suficiente — o LINKIN PARK tem distribuidora normal (Sato
Company, que também lança anime). Por isso a triagem **manda para revisão** em
vez de descartar, como o contexto já determina.

---

## 6. Vocabulário de tipo de sessão

De 813 sessões amostradas:

| `name` | `alias` | `id` | Natureza |
|---|---|---|---|
| Dublado | DUB | **0** | áudio |
| Legendado | LEG | **0** | áudio |
| Nacional | NAC | **0** | áudio (original pt-BR) |
| Normal | 2D | 1 | formato |
| Vip | VIP | 2 | formato |
| 3D | 3D | 4 | formato |
| XD | XD | 32 | formato |
| D-Box | D-BOX | 4096 | formato |
| Infinity Vision | INFINITY VISION | 16384 | formato |
| Dolby Atmos | Dolby Atmos | 524288 | formato |
| Laser | Laser | 1073741824 | formato |

**Regra estrutural, não lista de nomes:**

- `types[].id === 0` → é **áudio** (`Session.audio`)
- `types[].id > 0` → é **formato de sala** (`Session.roomType`); os ids são
  potências de 2, ou seja, máscara de bits
- `typeDescriptions.detailedImage` confirma: termina em `/copytype/` para áudio e
  `/sessiontype/` para formato

Isto é melhor do que casar por nome: uma sala nova do ingresso entra com id
próprio e é classificada certo sem precisar editar lista nenhuma. `3D` (id 4) é
formato, então `Session.is3d` sai daí.

**A regra já se pagou.** Rodando contra os três cinemas de Campinas (725
sessões), apareceram dois formatos que **não existiam na amostra de São Paulo**:

```
normal=329  vip=261  imax=60  xd=51  d-box=15  junior=6  cine-inclusivo=3
legendado=374  dublado=217  original=134
```

`Junior` e `Cine Inclusivo` foram classificados certo no primeiro sync, sem
nenhuma edição de configuração. Uma lista de nomes teria jogado os dois em
"normal" e eles sumiriam das tags.

📌 *Para o passo 6 (tags):* `Cine Inclusivo` é sessão acessível, mais perto de
um **tipo de sessão** do que de um tipo de sala. Hoje cai na faceta `sala`
porque a API o entrega como formato. Decidir lá se vira faceta própria.

O campo `sessions[].type` (array de strings) é a versão achatada do mesmo dado,
sem os ids — **preferir `types[]`**.

`rooms[].type` veio `null` em toda a amostra. Ignorar.

---

## 7. Onde o spec diverge do observado

| O spec diz | Na prática |
|---|---|
| `sessions/.../theater/...` → objeto | **array** de objetos, um por dia |
| não enumera `partnership` | valores mudam o resultado materialmente (§2) |
| não menciona charset | alguns caminhos devolvem UTF-16 (§3) |
| `count` sem descrição | é o tamanho da página, não o total (§4.4) |
| `/events/{id}/credits` documentado | devolve vazio (§4.6) |
| v1 existe | `paths` vazio; só v0 é real |

Por isso os schemas `zod` são escritos contra o **observado**, com campos
opcionais onde o spec marca `nullable`, e o canary de contrato é a rede de
segurança — não o spec.

---

## 8. Consequências para os canaries (§8)

- **Transporte:** 403 persistente = bloqueio. Nenhum 429 observado, mas a
  política de 4 simultâneas fica de pé.
- **Contrato:** validar o array-de-dias em sessões e o envelope `{items, count}`.
  Um `{items}` que vira objeto, ou `localDate` sem offset, quebra o parsing.
- **Semântico:** `theaters` = 0 ou queda brusca em `nowplaying` sugerem
  `partnership` rejeitado. Comparar sempre contra média móvel de 7 dias, nunca
  contra `count` de uma única resposta.
- **Matching:** `originalTitle` vem preenchido e é o melhor sinal disponível.
  Se a taxa de auto-match cair, suspeitar primeiro de mudança em `originalTitle`
  ou `duration`.

---

## 9. Configuração desta instância — Campinas

`INGRESSO_CITY_ID=14` · fuso `America/Sao_Paulo` · 6 cinemas na cidade.

A Carol acompanha só três shoppings, então `INGRESSO_THEATER_IDS=136,135,1524`:

| id | Cinema | Rede | Salas |
|---|---|---|---|
| `136` | Kinoplex Dom Pedro | Kinoplex | 15 |
| `135` | Cinemark Shopping Iguatemi Campinas | Cinemark | 11 |
| `1524` | Cinépolis Shopping Galleria Campinas | Cinépolis | 5 |

Fora da lista, de propósito:

| id | Cinema | Por quê |
|---|---|---|
| `1061` | Cine Araújo Multiplex Parque Das Bandeiras | outro shopping |
| `1057` | Cinépolis Campinas Shopping | outro shopping |
| `1587` | Parque D. Pedro Shopping | **não é cinema** |

⚠️ O id `1587` merece atenção: o nome contém "D. Pedro" e o endereço é o mesmo
shopping, mas a rede é `OUTROS EVENTOS`, tem 2 "salas" e o endereço real é
`Expo D. Pedro` — é o espaço de eventos, não o cinema. Ele responde **204** em
sessões. Uma busca por nome pegaria ele junto com o Kinoplex; por isso a lista
é por **id**, não por nome.

**Nota de escopo:** o `contexto.md` fala em acompanhar "cada cinema" da cidade e
não prevê filtro. A lista branca é um acréscimo posterior. Deixar
`INGRESSO_THEATER_IDS` vazio devolve o comportamento original, os 6 cinemas.

---

## 10. Verificação de ponta a ponta

Rodado contra a API real e o banco real em 22/09/2026, pelo `IngressoClient`:

| | |
|---|---|
| Requisições | 7, todas `200` |
| Cinemas da cidade | 6 → 3 após o filtro |
| Sessões normalizadas | **725** (186 Iguatemi + 202 Galleria + 337 Dom Pedro) |
| Eventos distintos | 34 |
| Em cartaz / pré-estreias / em breve | 39 / 8 / 161 |
| `RawPayload` gravados | 7, todos antes de qualquer parsing |
| Candidatos a não-filme detectados | 7 |

Os sete candidatos que a triagem da §5 pegou em Campinas — todos com
`type: "Filme"`, todos acima de 40 min:

```
Always Lalisa                                     Trafalgar          100 min
BTS World Tour 'Arirang' In Buenos Aires          Trafalgar          195 min
BTS World Tour 'Arirang' In São Paulo             Trafalgar          195 min
Maiara & Maraisa                                  Sem Distribuidor   120 min
Ozzy & Black Sabbath - Back To The Beginning      Sem Distribuidor   147 min
Queen Budapest                                    Trafalgar           97 min
Rammstein - Live In Mexico City                   Sem Distribuidor   110 min
```

Nenhum deles seria pego pelos sinais que o `contexto.md` previa originalmente.
