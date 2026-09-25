# App de Filmes — Contexto completo para o Claude Code

Este documento é a fonte de verdade do projeto. Leia inteiro antes de escrever qualquer linha de código.

## 0. Como trabalhar neste projeto

1. **Não escreva código antes de apresentar e ter aprovado o `schema.prisma` completo.** O modelo conceitual está na seção 6; transforme-o em schema real, mostre à Carol, espere aprovação.
2. Depois do schema, implemente **módulo por módulo**, na ordem da seção 15. Um módulo por vez, testado, antes do próximo.
3. Não pergunte sobre stack nem arquitetura: estão definidos aqui. Pergunte só o que estiver marcado como **[EM ABERTO]**.
4. Se algo neste documento não se encaixar na realidade (ex.: a API do ingresso devolver um formato diferente do esperado), **pare e avise** — nunca contorne em silêncio.
5. Ambiente de desenvolvimento: **Windows + PowerShell**. Comandos de terminal devem funcionar no PowerShell. **Não usar Docker.** Deploy é feito no Catploy.

## 1. Conceito

App pessoal para acompanhar cinema na cidade da Carol: filmes em cartaz em cada cinema, pré-estreias e próximos lançamentos, com metadata completa e notas de crítica. Uso privado por duas pessoas.

- **Dois perfis:** `CatFlix` (Carol) e `HBUrso` (o namorado dela). Cada perfil tem sua cor de acento e seu estado próprio (quero ver, marcado, visto).
- **Dados por filme:** título, diretor, estúdio, elenco principal, gêneros, duração, nota IMDb, nota Rotten Tomatoes, pôster, sessões por cinema e tipo de sala, link para a página do filme no ingresso.com.
- **Clique no card:** abre o detalhe completo do filme, com botão que leva à página do filme no ingresso.com.
- **Tags robustas:** facetas automáticas (cinema, tipo de sala, áudio) derivadas das sessões + tags manuais dos usuários.
- **Visual:** tema escuro, estrutura inspirada em apps de streaming (hero + trilhas de pôsteres). Ver seção 12.

## 2. Decisões já tomadas

- O ingresso.com **publica um OpenAPI** em `https://api-content.ingresso.com/swagger/index.html` (spec real: `/swagger/v0/swagger.json`, 36 endpoints; o `v1` existe mas tem `paths` vazio). *Corrigido em 22/09/2026: este documento antes afirmava que não havia API pública.* Isso nos dá os nomes e tipos dos campos sem adivinhação — mas **não** é contrato de uso: não há versionamento prometido, limite de taxa documentado nem autenticação, e o spec diverge do observado em pelo menos cinco pontos. Por isso segue valendo: **todo acesso é pelo backend, com cache no Postgres, e canaries detectam quebras** (seção 8). O levantamento vive em `backend/src/modules/ingresso/CONTRATO.md` e é a referência operacional; esta seção só registra a decisão.
- Rotten Tomatoes e IMDb **não têm API aberta**. As notas vêm do **OMDb** (`imdbRating` + array `Ratings`, onde está o RT). Metadata (diretor, elenco, gêneros, duração, pôster, estúdio, IDs externos) vem do **TMDB**.
- A chave canônica de um filme é o **`tmdb_id`**. É também a chave usada por Radarr e Jellyfin, o que prepara as integrações futuras.
- **Nenhum filme some.** Evento do ingresso que não casar com TMDB vira título "órfão", visível no app com aviso de metadata pendente, e entra na fila de revisão.
- **Nenhum match duvidoso é aceito em silêncio.** Abaixo do limiar vai para revisão humana.
- A página **Revisar** fica na navegação, **escondida quando a fila está vazia**, com **badge numérica** quando há pendências.
- Integração com **Crônicas de Gatur fica para depois.** Não implementar agora; só deixar o ponto de extensão (seção 14).

## 3. [EM ABERTO] — perguntar à Carol quando chegar a hora

- ~~**Autenticação dos dois perfis:**~~ ✅ **Resolvido em 23/09/2026: login próprio.** Tela de login com **seletor de perfil** (CatFlix ou HBUrso) e **senha definida no `.env`**. Uma senha por perfil (`AUTH_PASSWORD_CATFLIX`, `AUTH_PASSWORD_HBURSO`), com `AUTH_PASSWORD` servindo de padrão para os dois.

  **Como foi implementado:** cookie `httpOnly` assinado com HMAC-SHA256 (`AUTH_SECRET`), não JWT em `localStorage` — o app roda como PWA no celular dos dois, e token que o JavaScript enxerga é token que um script injetado rouba. Zero dependência nova.

  O middleware isolado que esta seção pedia continua valendo e cumpriu o papel: trocar a estratégia foi mexer em `users.sessao.ts` e `users.middleware.ts`; nenhum controller de catálogo ou de revisão mudou de forma. Se um dia o Crônicas de Gatur (§14) quiser sessão compartilhada, é nesses dois arquivos.

  **Tudo fica atrás do login** — não há rota pública além de `/api/health` e `/api/auth/*`. `?user=` só é aceito quando bate com o perfil da sessão: sem isso, trocar um parâmetro na URL mostraria a home do outro.

  ⚠️ **Sem `AUTH_SECRET` e senha configuradas, o backend recusa subir em produção** (em desenvolvimento, avisa e usa segredo efêmero). Não há senha padrão de fábrica de propósito.
- ~~**Canal de alerta dos canaries:**~~ ✅ **Resolvido em 22/09/2026: notificação pelo PWA do próprio app** (Web Push). A interface `Notifier` continua valendo, com três implementações: log (sempre ligada, é o piso), webhook genérico (fica, mas sem uso) e **Web Push para os dispositivos inscritos**.

  ⚠️ **Restrição do iOS, e ela afeta a Carol:** o Safari só entrega Web Push se o PWA estiver **instalado na tela de início** (iOS 16.4+). Aberto pelo navegador, não chega nada.

  **Aparelhos (informado em 22/09/2026):** Carol = **iPhone**, HBUrso = **Android**. Ou seja, no aparelho do HBUrso funciona direto; **no da Carol, só depois de instalar** — e é ela quem mais acompanha a fila de revisão. Por isso a tela de perfil **precisa** detectar iOS sem instalação e mostrar o passo a passo do "Adicionar à Tela de Início" (passo 10). Não é um extra.

  ⚠️ **Dependência de ordem:** o envio só pode ser verificado de ponta a ponta quando o service worker existir (passo 10). Até lá, o log segue sendo o canal que de fato entrega.
- ~~**Cidade:** vem de variável de ambiente (`INGRESSO_CITY_ID`).~~ ✅ **Resolvido em 22/09/2026: Campinas, `INGRESSO_CITY_ID=14`.** Segue vindo de variável de ambiente — não assuma cidade no código.
- ✅ **Acréscimo de 22/09/2026, a pedido da Carol:** só três cinemas, não os 6 da cidade — Kinoplex Dom Pedro (`136`), Cinemark Iguatemi (`135`) e Cinépolis Galleria (`1524`), via `INGRESSO_THEATER_IDS`. Vazio = todos os cinemas da cidade, o comportamento que a seção 1 descreve. Filtrar **por id, nunca por nome**: existe um "Parque D. Pedro Shopping" (`1587`) no mesmo endereço que é espaço de eventos, não cinema.
- ~~**Card de pré-estreias no desktop:**~~ ✅ **Resolvido em 23/09/2026: o desktop segue o mobile.** O card horizontal do `desktop-catflix.html` está descartado; **card de pôster único em todas as trilhas, nos dois tamanhos de tela.** Motivo dado pela Carol: o app será usado majoritariamente no mobile. Regra geral que decorre disso: em qualquer conflito entre os modelos, **o mobile manda** — não só nos componentes compartilhados, como dizia a seção 12, mas no layout também.
- ~~**Página de detalhe do filme:**~~ ✅ **Resolvido em 23/09/2026: não precisa propor layout antes.** Seguir o estilo das telas já modeladas (tokens da seção 12, componentes da home e da revisão) e implementar direto. Vale para qualquer tela sem modelo, não só o detalhe.

## 4. Stack (fixo)

- **TypeScript** em todo o projeto.
- **Backend:** Node.js + Express.
- **Frontend:** React + Vite.
- **Banco:** PostgreSQL via **Prisma ORM**. Habilitar extensão `pg_trgm` (usada no matching).
- **Estilo:** **SCSS Modules**, um `.module.scss` por componente/tela. Nunca Tailwind, nunca CSS-in-JS.
- **Validação de payload externo:** `zod`.
- **Agendamento de jobs:** `node-cron` dentro do backend (sem serviço extra, sem Docker).
- **Sem Docker.**

## 5. Fontes externas

### 5.1 Ingresso.com (OpenAPI publicado, sem contrato de uso)

- Base: `https://api-content.ingresso.com/v0/`
- Recursos confirmados: estados e cidades (com fuso horário), cinemas por cidade, sessões por cinema, e listas de em cartaz / pré-estreia / em breve / destaques por cidade.
- ✅ **Contrato levantado em 22/09/2026** e documentado em `backend/src/modules/ingresso/CONTRATO.md` (URL, parâmetros, exemplo de resposta, campos usados, divergências entre spec e realidade). **Esse arquivo é a referência ao escrever os schemas `zod`, não o spec** — o spec erra a forma da resposta de sessões, entre outras coisas.
- Três armadilhas que o CONTRATO.md detalha e que os schemas precisam respeitar: o parâmetro obrigatório e não documentado `partnership`; respostas em **UTF-16** em alguns caminhos; e **`204 No Content`** para cinema sem sessão.
- Regras de acesso: User-Agent honesto e fixo, concorrência máxima de 4 requisições, backoff exponencial, respeitar 429, nunca chamar a partir do navegador.
- Toda resposta bruta é gravada em `RawPayload` antes de qualquer parsing (seção 7.1).

### 5.2 TMDB

- API v3 com chave (`TMDB_API_KEY`).
- Busca: `search/movie` com `language=pt-BR`, `query` e `year`/`primary_release_year`.
- Detalhe: `movie/{id}` com `append_to_response=credits,external_ids,release_dates` e `language=pt-BR` — daí saem diretor (crew com job Director), elenco principal (primeiros N do cast), gêneros, duração, estúdios (`production_companies`), pôster, backdrop e `imdb_id`.
- Cache de metadata: 30 dias.

### 5.3 OMDb

- Chave em `OMDB_API_KEY`. Tier grátis: 1.000 requisições/dia.
- Busca **sempre por `imdb_id`** (`?i=tt...`), nunca por título.
- Usar `imdbRating` e, dentro de `Ratings`, o item cuja fonte é Rotten Tomatoes (vem como string tipo `"87%"`).
- **Qualquer nota pode faltar.** Campos de nota são nullable; ausência nunca quebra o fluxo.
- Nunca chamar OMDb durante uma requisição de usuário — só em job.
- Atualização de notas: diária na primeira semana após a estreia, semanal depois.

## 6. Modelo de dados (conceitual — transformar em `schema.prisma` e apresentar)

**Camada crua e operação**

- `RawPayload` — fonte, endpoint, parâmetros, hash do corpo, corpo (jsonb), status HTTP, `fetchedAt`. Permite reprocessar o histórico sem chamar a API de novo.
- `SyncRun` — tipo de job, início, fim, status, contagens (lidos, novos, casados, enviados à revisão, erros), mensagem de erro.
- `CanaryCheck` — camada (transporte, contrato, semântico, matching), alvo, resultado, valor medido, limiar, `checkedAt`.
- `Alert` — canary de origem, severidade, mensagem, `sentAt`, `resolvedAt`.

**Catálogo canônico**

- `Title` — a obra. `mediaType` (`movie` | `series`, **desde já**, mesmo só usando filmes), título pt-BR, título original, ano, duração, sinopse, pôster, backdrop, `status` (`matched` | `orphan` | `not_a_film`), notas IMDb e RT (nullable) com `ratingsUpdatedAt`.
- `TitleExternalId` — `titleId`, `source` (`ingresso`, `tmdb`, `imdb`; previstos: `tvdb`, `radarr`, `sonarr`, `jellyfin`), `externalId`, `confidence`, `method` (`cache`, `exact`, `fuzzy`, `manual`), `verifiedBy`, `verifiedAt`. **Unique em `(source, externalId)`.** Vários IDs do ingresso podem apontar para o mesmo `Title`.
- Unique parcial em `tmdb_id` (via `TitleExternalId` com `source = tmdb`): um filme do TMDB só pode existir uma vez.
- `TitleAlias` — registro de merges (`fromTitleId`, `toTitleId`, motivo, data), para o sync não separar de novo o que foi unido.
- `Person`, `TitleCredit` (papel: diretor, elenco, com ordem), `Genre`, `TitleGenre`, `Company`, `TitleCompany`.

**Cinema**

- `Cinema` — id do ingresso, nome, rede, endereço, cidade.
- `Session` — `titleId`, `cinemaId`, início (`timestamptz`) + fuso da cidade, tipo de sala (normal, IMAX, XD, VIP, Dolby, D-BOX, 4DX…), áudio (dublado/legendado/original), 3D, tipo de sessão (regular, pré-estreia, especial), URL de compra.
- `Availability` — `titleId`, `source`, `status`. Hoje: `cinema:em_cartaz`, `cinema:pre_estreia`, `cinema:em_breve`. Previsto: `jellyfin:na_biblioteca`, `radarr:monitorado`. **Separado do estado do usuário.**

**Usuários e tags**

- `User` — dois registros fixos: `catflix` e `hburso`, com cor de acento.
- `UserTitleState` — `userId`, `titleId`, `status` (`quero_ver`, `marcado`, `visto`), datas. **Separado de `Availability`.**
- `Tag` — faceta (`sala`, `cinema`, `audio`, `manual`), valor, `origin` (`auto` | `manual`), dono (para manual).
- `TitleTag` — `titleId`, `tagId`, `origin`. Tags `auto` são recalculadas a partir das sessões a cada sync; tags `manual` nunca são tocadas pelo sync.

**Matching**

- `MatchDecision` — log de cada decisão: evento do ingresso, candidato, score e composição do score, estágio, resultado, data. Nada decide sem deixar rastro.
- `ReviewItem` — evento do ingresso, candidato sugerido (nullable), score, motivo (`low_confidence`, `no_candidate`, `possible_duplicate`, `probable_non_film`), status (`open`, `resolved`), resolução escolhida.

Migrations devem somar ao schema sempre que possível; nada destrutivo em tabelas existentes.

## 7. Pipeline de sync e matching

### 7.1 Camada crua primeiro

Fetch → grava `RawPayload` → valida com `zod` → parseia. Se a validação falhar, dispara canary de contrato e **não** atualiza o catálogo com dado quebrado.

### 7.2 Estágios do matching (em ordem, cada um grava `MatchDecision`)

0. **Cache de decisão.** O ID do evento do ingresso já tem `TitleExternalId`? Usa e para. Idempotente.
1. **Triagem "isso é filme?".** Sinais: duração < 40 min; palavras-chave de evento (ópera, ao vivo, show, culto, maratona, "Kids" como programa, transmissões, "Live Viewing", "World Tour"); distribuidora de evento (Trafalgar e afins); e distribuidor "ausente". Aparece no app como evento sem metadata. **Este filtro é o que mais evita falso positivo.**

   ⚠️ *Corrigido em 22/09/2026, após sondar a API (ver CONTRATO.md §5).* Duas suposições desta seção não sobreviveram ao contato com os dados reais:
   - **O campo `type` do ingresso é sempre `"Filme"`** — inclusive em show, ópera e transmissão ao vivo. Não serve para discriminar nada.
   - **O distribuidor nunca vem nulo ou vazio:** vem a string literal `"Sem Distribuidor"`. Testar por ausência não pega caso nenhum.

   Nenhum sinal sozinho é suficiente (um show da Sato Company tem distribuidora normal, e um evento de 195 min passa longe do corte de 40), então a triagem **manda para revisão** em vez de descartar. Os sinais ficam em `backend/src/config/title-suffixes.json`, com versão.
2. **Match forte.** Se houver título original, busca no TMDB por título original + ano (±1). Aceita se o ano bate e a duração difere menos de 7 min.
3. **Match fuzzy.** Normalizador antes: minúsculas, sem acento, remover sufixos (`- Dublado`, `- Legendado`, `(Leg)`, `(Dub)`, `Reexibição`, `Pré-estreia`, `Sessão Especial`, nome de rede, `IMAX`, `4DX`, `3D`…). Lista de sufixos em arquivo de configuração, não hardcoded no algoritmo. Similaridade com `pg_trgm`. **Score composto:** título 0.5, duração 0.2, ano 0.2, diretor/elenco em comum 0.1.
4. **Limiares.**
   - ≥ 0.92 → aceita automaticamente.
   - 0.75 a 0.92 → `ReviewItem` com o candidato.
   - < 0.75 → cria `Title` órfão visível + `ReviewItem` sem candidato.
   - Limiares em configuração, não hardcoded.

### 7.3 Deduplicação

- O mesmo filme chega como vários eventos (redes diferentes, dublado/legendado, IMAX, pré-estreia): resolvido pelo modelo — vários `TitleExternalId` do ingresso, um `Title`.
- Dois `Title` que são o mesmo filme: detectados pela unicidade do `tmdb_id` → `ReviewItem` com motivo `possible_duplicate`.
- Função `mergeTitles(from, to)`: reaponta todas as FKs (sessões, IDs externos, tags, estados de usuário), grava `TitleAlias`, numa transação.

### 7.4 Casos de teste obrigatórios (fixtures)

Os quatro casos do modelo de design da fila de revisão precisam virar testes automatizados do matching:

1. `DUNA PARTE 2 - REEXIBIÇÃO ESPECIAL IMAX` → deve casar com *Dune: Part Two* depois da normalização.
2. `MET ÓPERA: LA BOHÈME AO VIVO` → deve cair na triagem como `not_a_film`.
3. `O BRUTALISTA (LEG)` → candidato *The Brutalist* com divergência de ano → revisão.
4. `DIVERTIDAMENTE 2 - SESSÃO KIDS` → deve ser detectado como mesmo filme que *Divertida Mente 2* já existente.

## 8. Canaries

Quatro camadas, cada uma gravando `CanaryCheck`:

- **Transporte:** HTTP diferente de 200, timeout, 403 ou 429. 403 persistente = bloqueio, severidade alta.
- **Contrato:** payload falhou no schema `zod` (campo sumiu, mudou de tipo, URL de compra mudou de formato).
- **Semântico:** número de eventos caiu mais de 40% em relação à média móvel de 7 dias; zero pré-estreias num período onde sempre há; um cinema que sempre aparece sumiu.
- **Matching:** taxa de auto-match abaixo do baseline. É o que pega mudança silenciosa no formato dos títulos.

Regras:

- Alertas passam pela interface `Notifier` (ver [EM ABERTO]). Não reenviar o mesmo alerta enquanto não resolvido.
- **Modo degradado obrigatório:** se a API cair, o app continua servindo o cache e mostra "dados de X horas atrás". Nunca tela vazia.
- Expor `GET /api/health/sync` com estado do último sync e dos canaries.

## 9. Jobs

- Sessões e em cartaz: 3× ao dia.
- Pré-estreias e em breve: 1× ao dia.
- Metadata TMDB: sob demanda quando surge título novo + refresh a cada 30 dias.
- Notas OMDb: conforme regra da seção 5.3.
- Recalcular tags `auto` ao fim de cada sync de sessões.
- Todo job é idempotente, registra `SyncRun`, e pode ser disparado manualmente (botão "Sincronizar agora" no app).

## 10. API (backend)

Prefixo `/api`. Sugestão inicial — ajustar ao implementar e documentar:

- `GET /titles` — filtros: `availability`, `tag[]`, `cinema`, `user`, `status`, busca textual.
- `GET /titles/:id` — detalhe completo: metadata, notas, sessões agrupadas por cinema e sala, tags, estado de cada usuário, URL do ingresso.
- `GET /home?user=` — dados já agrupados para a home (hero + trilhas).
- `GET /sessions?titleId=&date=`
- `GET /tags` — facetas com contagem (alimenta o painel de tags).
- `POST /titles/:id/tags`, `DELETE /titles/:id/tags/:tagId` — só tags manuais.
- `PUT /users/:userId/titles/:titleId/state`
- `GET /review` — fila aberta. `GET /review/count` — número para o badge.
- `POST /review/:id/confirm`, `POST /review/:id/replace` (com `tmdbId`), `POST /review/:id/not-a-film`, `POST /review/:id/merge`.
- `POST /sync/run` — disparo manual.
- `GET /health/sync`

## 11. Estrutura de pastas

Dois diretórios de topo, fisicamente separados: `backend/` e `frontend/`.

### Backend

```
backend/
  prisma/schema.prisma
  src/
    app.ts
    server.ts
    config/            # env, limiares, lista de sufixos do normalizador
    shared/            # http client com retry/backoff, prisma client, logger, erros, tipos comuns
    modules/
      ingresso/        # client + zod + parse; CONTRATO.md
      tmdb/            # client + parse
      omdb/            # client + parse
      catalog/         # Title, créditos, gêneros, merge
      cinemas/         # Cinema, Session, Availability
      matching/        # normalizador, triagem, score, decisões
      review/          # fila de revisão
      tags/            # facetas auto + tags manuais
      users/           # perfis, UserTitleState, middleware de auth isolado
      canaries/        # checagens, Notifier, health
      sync/            # ORQUESTRADOR: jobs que usam os módulos acima
      integrations/    # interface de adapters (vazio por ora, ver seção 13)
```

Cada módulo: `*.controller.ts`, `*.service.ts`, `*.routes.ts`, `*.types.ts`. Lógica de negócio só no service.

**Dependências:** `sync` é o orquestrador e pode depender de todos. `matching` pode depender de `tmdb` e `catalog`. Módulos de fonte (`ingresso`, `tmdb`, `omdb`) não conhecem uns aos outros nem o catálogo. Nenhum módulo de conteúdo depende do `sync`.

### Frontend

```
frontend/
  src/
    main.tsx
    reset.scss         # único SCSS global: reset + tipografia base + variáveis de tema por perfil
    shared/
      styles/_tokens.scss   # variáveis SCSS (sem CSS gerado), usado via @use
      components/      # PosterCard, HeroCard, PillFilter, Badge, BottomNav, Sidebar, RatingBadges, Chip
      api/             # client HTTP
      hooks/
    modules/
      home/
      title-detail/
      review/
      tags/
      profile/
      health/          # tela simples de estado do sync
```

Um `.module.scss` por componente/tela.

**Desvio de padrão a confirmar com a Carol:** o tema por perfil precisa de variáveis CSS globais (`--accent`, `--accent-soft`, `--accent-text`, `--accent-2`) trocadas por `data-profile` no `<html>`. A proposta é colocá-las no `reset.scss`, que já é a única exceção global permitida. Confirme antes.

## 12. Design

### Modelos

Na pasta `design/` estão as páginas-modelo aprovadas. São **referência de marcação e medidas**, não código para copiar: usam um formato de canvas próprio, onde `{{...}}` são slots de dados, `<sc-for>` é um loop e `<sc-if>` é uma condicional. Os links internos entre elas apontam para nomes antigos de arquivo.

| Arquivo | Tela |
|---|---|
| `desktop-catflix.html` | Home desktop, perfil CatFlix, com item Revisar + badge na sidebar |
| `desktop-hburso.html` | Home desktop, perfil HBUrso, fila vazia → item Revisar ausente |
| `desktop-revisar.html` | Fila de revisão desktop |
| `mobile-catflix.html` | Home mobile CatFlix |
| `mobile-hburso.html` | Home mobile HBUrso |
| `mobile-revisar.html` | Fila de revisão mobile |
| `mobile-tags.html` | Painel de tags sobreposto à home |

**Os modelos mobile são a direção mais recente**; em conflito com o desktop, o mobile manda nos componentes compartilhados (card de pôster, pills, badge). *Ampliado em 23/09/2026 (ver seção 3): o mobile manda também no layout.* O desktop é a mesma home em telas maiores — sidebar no lugar da barra flutuante, trilhas mais largas — e **não** tem card horizontal de pré-estreia. O `desktop-catflix.html` vale como referência de sidebar e medidas, não de card.

### Tokens

- Fundo: `#0B0A0F`. Faixa de ambiente atrás do hero: `#171021` (CatFlix), `#151327` (HBUrso).
- Superfícies: `#121019` (sidebar/barras), `#15121D` (cards), `#1C1927` (chips neutros).
- Bordas: `#221E2E`, `#2A2537`, `#2E2A3C`.
- Texto: `#F4F1F8` principal, `#CFC9DB` secundário, `#A79FB5` apoio, `#8C85A0` rótulos, `#6F6883` rótulos de grupo.
- **CatFlix:** acento `#FF4D8D`, fundo suave `rgba(255, 77, 141, 0.16)`, texto sobre fundo suave `#FFA9C8`, texto sobre acento sólido `#24040F`.
- **HBUrso:** acento principal roxo `#9D7BFF`, suave `rgba(157, 123, 255, 0.18)`, texto `#C7B1FF`, texto sobre sólido `#150A28`. Secundário laranja `#FF8A3D` (faixas de pôster, chips de sala), suave `rgba(255, 138, 61, 0.16)`, texto `#FFB27A`. **Roxo manda, laranja é secundário** — não dar o mesmo peso aos dois.
- Marcadores de nota: quadrado `#F5C518` para IMDb, círculo `#FA320A` para RT, sempre com o valor em texto ao lado.
- Tipografia: **Bricolage Grotesque** (títulos, display) e **Instrument Sans** (texto), via Google Fonts, com fallback `system-ui, sans-serif`.
- Alvo de toque mínimo: 44 px.

### Componentes e regras

- **PosterCard (único):** pôster 2:3, cantos de 6 px no mobile, círculo com a inicial de quem marcou (C rosa / H roxo) no canto superior direito, faixa colorida opcional no rodapé do pôster para urgência ("Qui · 23h59", "Última semana"), notas IMDb/RT abaixo, linha de cinema/sala. **Todos os cards de trilha são idênticos**; só o conteúdo muda.
- **HeroCard:** pôster alto, título grande, linha de taxonomia com separadores (Filme • gênero • sala • áudio), botão primário claro de largura total ("Ver sessões") e secundário translúcido de largura total ("Marcar com o Urso" / "Marcar com a Gata").
- **Trilhas horizontais** com título acima; o próximo card espia na borda direita.
- **Pills de filtro** translúcidas no topo: Em cartaz, Pré-estreias, Em breve, Tags ▾.
- **Painel de tags:** desliza da direita sobre a home escurecida, agrupado por faceta (sala, cinema, áudio, suas tags), com contagem por item e item ativo destacado.
- **Navegação:** desktop com sidebar; mobile com barra flutuante em pílula. Revisar: desktop na sidebar sob "Manutenção"; mobile como ícone com badge no cabeçalho. **Sem pendências, o item não é renderizado.**
- **Estado degradado:** aviso discreto "dados de X horas atrás" quando o último sync falhou.
- Não reproduzir a identidade visual da Netflix (vermelho, logotipo, tipografia). Estrutura inspirada, marca própria.

## 13. Integrações futuras (Jellyfin, Radarr, Sonarr)

Não implementar agora. A arquitetura já prepara:

- `tmdb_id` como chave canônica (Radarr), espaço para `tvdb_id` (Sonarr) e `mediaType` desde o primeiro migration.
- `Availability` por fonte, para o card mostrar "em cartaz" e "já tenho em casa".
- `UserTitleState` separado, para receber "visto" via webhook do Jellyfin.
- Módulo `integrations/` com uma interface comum de adapter, por exemplo `addToLibrary(tmdbId)` e `getLibraryState(tmdbId)`. Cada serviço vira um arquivo que implementa a interface — nunca `if (radarr)` espalhado pelo código.

## 14. Crônicas de Gatur

Adiado por decisão da Carol. Não implementar. Apenas não tomar decisões que impeçam: o estado "marcado" vive em `UserTitleState`, e a origem futura dessa marcação poderá ser um adapter em `integrations/`.

Referência do outro projeto, caso seja útil depois: Node.js/Express, PostgreSQL, React 18/Vite, autenticação JWT.

## 15. Ordem de implementação

1. `schema.prisma` completo → **apresentar e esperar aprovação.**
2. Esqueleto `backend/` e `frontend/`, `shared/` (http client com retry/backoff, prisma, logger), variáveis de ambiente, `reset.scss` e tokens.
3. `ingresso`: descobrir endpoints, `CONTRATO.md`, schemas `zod`, gravação de `RawPayload`.
4. `tmdb` e `omdb`.
5. `matching` com os quatro testes da seção 7.4 passando.
6. `catalog`, `cinemas`, `tags` (auto).
7. `sync` (orquestrador) + `node-cron`.
8. `canaries` + `Notifier` + `/health/sync`.
9. `review` (backend).
10. Frontend: home mobile → home desktop → revisar → painel de tags → detalhe (propor antes) → perfis.
11. Tags manuais e `UserTitleState`.
12. Deploy no Catploy.

## 16. Variáveis de ambiente

```
DATABASE_URL=
TMDB_API_KEY=
OMDB_API_KEY=
INGRESSO_CITY_ID=
INGRESSO_USER_AGENT=
NOTIFIER_WEBHOOK_URL=
MATCH_AUTO_THRESHOLD=0.92
MATCH_REVIEW_THRESHOLD=0.75

# autenticação (§3, resolvido em 23/09/2026) — sem elas o backend não sobe em produção
AUTH_SECRET=                 # assina o cookie de sessão; trocar desloga os dois
AUTH_PASSWORD=               # padrão para os dois perfis
AUTH_PASSWORD_CATFLIX=       # ganha do padrão, quando definida
AUTH_PASSWORD_HBURSO=
AUTH_SESSION_DAYS=30

# acrescentadas em 22/09/2026, ver CONTRATO.md §2 e §9
INGRESSO_PARTNERSHIP=www     # obrigatório na API e não documentado; muda o resultado
INGRESSO_THEATER_IDS=        # lista branca de cinemas; vazio = todos os da cidade
```

O `backend/.env.example` tem ainda as variáveis de operação (porta, log, URLs base, limites do cliente HTTP, janela do modo degradado), todas com padrão sensato.

## 17. Critérios de aceite

- Nenhum evento do ingresso fica sem aparecer no app (casado, órfão ou marcado como não-filme).
- Nenhum `tmdb_id` aparece em dois `Title`.
- Toda decisão de matching tem `MatchDecision` correspondente.
- Os quatro testes da seção 7.4 passam.
- Derrubar a API do ingresso (simulado) mantém o app funcionando com cache e dispara alerta.
- Com a fila de revisão vazia, o item Revisar não aparece; com itens, aparece com a contagem correta.
- Trocar de perfil troca as cores de acento sem recarregar a página.
