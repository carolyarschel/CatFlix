# App de Filmes

Acompanhamento de cinema na cidade: filmes em cartaz por cinema, pré-estreias e
próximos lançamentos, com metadata completa e notas de crítica. Uso privado,
dois perfis (CatFlix e HBUrso).

A fonte de verdade do projeto é [`contexto.md`](contexto.md). Este README é só
como pôr para rodar.

## Estrutura

```
backend/    Node.js + Express + Prisma (PostgreSQL)
frontend/   React + Vite + SCSS Modules
design/     páginas-modelo aprovadas (referência de marcação e medidas)
```

## Pré-requisitos

- Node.js 20 ou mais novo (testado no 24)
- PostgreSQL 14 ou mais novo, rodando local (sem Docker, por decisão do projeto)
- Windows + PowerShell

## Primeira execução

### 1. Banco

Crie o banco e habilite a extensão usada no matching:

```powershell
psql -U postgres -c "CREATE DATABASE filmes;"
psql -U postgres -d filmes -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### 2. Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env    # preencha DATABASE_URL e as chaves de API
npx prisma migrate dev --name init
npm run seed                   # cria os perfis catflix e hburso
npm run dev                    # http://localhost:3333
```

> Antes de aplicar o primeiro migration, leia
> [`backend/prisma/MIGRATIONS.md`](backend/prisma/MIGRATIONS.md): há quatro
> índices parciais que o Prisma não declara sozinho e que são regras reais de
> integridade do modelo.

O app sobe mesmo sem `TMDB_API_KEY`, `OMDB_API_KEY` e `INGRESSO_CITY_ID` — ele
avisa no boot quais faltam e os jobs correspondentes não rodam. Nada é
contornado em silêncio.

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

O Vite faz proxy de `/api` para `localhost:3333`, então não há CORS em dev e o
caminho é o mesmo em produção. O frontend nunca fala com o ingresso.com, o TMDB
ou o OMDb direto — só com o backend.

## Scripts

| Onde | Comando | O quê |
|---|---|---|
| backend | `npm run dev` | servidor com reload |
| backend | `npm run typecheck` | TypeScript sem emitir |
| backend | `npm test` | vitest |
| backend | `npm run prisma:studio` | inspeção do banco |
| backend | `npm run seed` | garante os dois perfis |
| frontend | `npm run dev` | Vite |
| frontend | `npm run build` | typecheck + build |

## Estado atual

Passos 1 a 11 da seção 15 do contexto concluídos; falta o 12 (deploy no
Catploy):

| Passo | O quê | Estado |
|---|---|---|
| 1 | `schema.prisma` | aprovado e aplicado — 22 tabelas, 4 índices parciais |
| 2 | Esqueleto, `shared/`, tokens, `reset.scss` | de pé |
| 3 | `ingresso`: contrato, `zod`, `RawPayload` | 725 sessões reais lidas |
| 4 | `tmdb` e `omdb` | metadata e notas reais lidas |
| 5 | `matching` | os 4 testes do §7.4 passam; 34 eventos reais decididos |
| 6 | `catalog`, `cinemas`, `tags` | banco populado com Campinas |
| 7 | `sync` + `node-cron` | 4 jobs agendados, `POST /sync/run` |
| 8 | `canaries` + `Notifier` | 4 camadas, alertas sem repetição, Web Push |
| 9 | `review` (backend) | fila, badge e as 5 resoluções |
| 10 | Frontend | concluído — home, revisar, tags, detalhe e perfil |
| 11 | Tags manuais e `UserTitleState` | concluído |

Cada módulo de fonte tem seu `CONTRATO.md` com as armadilhas medidas na API
real — leia antes de mexer no módulo:

- [`modules/ingresso/CONTRATO.md`](backend/src/modules/ingresso/CONTRATO.md)
- [`modules/tmdb/CONTRATO.md`](backend/src/modules/tmdb/CONTRATO.md)
- [`modules/omdb/CONTRATO.md`](backend/src/modules/omdb/CONTRATO.md)

O banco tem dado real de Campinas: os três cinemas, 110 títulos com metadata do
TMDB, 703 sessões ativas, 13 facetas e 70 pendências de revisão.

### Agenda dos jobs (§9)

| Job | Quando | O quê |
|---|---|---|
| `sessoes` | 06h, 13h, 20h | cinemas, sessões, matching, catálogo, disponibilidade, tags |
| `proximos` | 05h30 | pré-estreias e em breve |
| `metadata` | 04h | refresh do TMDB vencido (30 dias) |
| `notas` | 04h30 | IMDb e Rotten Tomatoes |

Fuso `America/Sao_Paulo`, não o do servidor. O agendador fica **desligado em
desenvolvimento** e ligado em produção; `CRON_ENABLED` força qualquer um dos
dois.

**Em cartaz ganha de em breve e de pré-estreia.** Ao abrir `em_cartaz` para um
título, a `em_breve` e a `pre_estreia` dele são fechadas; e o `proximos` não
reabre nenhuma das duas para quem já está em cartaz. Um filme que estreou não
está "em breve" nem em "pré-estreia". A regra mora em `marcarDisponibilidade`,
no ponto de escrita, **não no job** — senão dependeria de quem roda primeiro, e
o `proximos` das 05h30 reabriria todo dia o que o `sessoes` das 20h fechou,
deixando a home errada das 05h30 às 06h.

As duas juntas **antes** da estreia continuam válidas: o ingresso lista o filme
em "em breve" e já abre a sessão de pré-estreia.

⚠️ Isto conserta a **disponibilidade**, que é o que a home e os filtros usam. O
campo `Session.sessionKind` continua torto por outro motivo (pendência 1), e por
isso o detalhe não mostra o tipo da sessão.

Fecha com `endedAt`, como `encerrarDisponibilidadeAusente`: "esteve anunciado
como em breve até tal dia" continua respondível. Coberta por
`modules/cinemas/cinemas.disponibilidade.integracao.test.ts`, que testa também a
ordem ruim.

*Achado em 24/09/2026 ao ligar a pill "Em breve" junto de uma tag: 7 títulos
tinham `em_cartaz + em_breve` e outros 8 `em_cartaz + pre_estreia`. As linhas já
erradas foram curadas pelo mesmo caminho de código, nas duas rodadas; hoje não
há nenhum título com disponibilidade futura aberta estando em cartaz.*

⚠️ **Consequência para o painel de tags:** "Em breve" cruzado com tag dá vazio
quase sempre, porque sala, cinema e áudio saem das **sessões** e o que ainda não
estreou não tem sessão. Não é defeito do filtro — o estado vazio diz isso e
oferece os dois caminhos de volta.

Disparo manual: `POST /api/sync/run` (corpo `{"job":"sessoes"}` para um só,
`{"aguardar":true}` para esperar o fim em vez de receber 202).

### Canaries (§8)

| Camada | Pega |
|---|---|
| transporte | a API caiu, bloqueou (403 persistente) ou está limitando |
| contrato | o payload mudou de formato e o `zod` recusou |
| semântico | a API responde bem, mas o conteúdo encolheu ou um cinema sumiu |
| matching | tudo normal, mas os títulos pararam de casar |

Alertas passam pela interface `Notifier` e **não se repetem enquanto não
resolvidos** — garantia do índice parcial `alerts_one_open_per_fingerprint`, não
só do código. Quando a checagem volta a passar, o alerta se resolve sozinho.

#### Tela de perfil

Três coisas: quem está usando o app, **as notificações** e o estado do sync. A
tela de estado do sync que o §11 previa como módulo próprio acabou aqui —
quem clica num alerta quer, no mesmo lugar, o que quebrou e como continuar sendo
avisado. `/health` e `/perfil` levam à mesma tela, e `/health` é para onde o Web
Push aponta.

**O passo a passo do "Adicionar à Tela de Início" é o motivo de a tela existir.**
No iPhone fora da tela de início o `PushManager` nem existe: não há inscrição,
não há erro, não chega nada. Por isso `precisa_instalar` é um estado próprio do
`useNotificacoes`, com as instruções em destaque — e não uma frase solta. Os
passos citam o ícone ("o quadrado com a seta para cima") porque o botão de
compartilhar do Safari não tem rótulo em texto.

O PWA vive na seção própria abaixo.

**Verificado de ponta a ponta em 24/09/2026:** a tela inscreveu o aparelho
(`POST /push/inscrever` → 201), o `Notifier` do backend disparou dois alertas
distintos, o FCM entregou, e o service worker mostrou **duas** notificações
separadas — a `tag` é o fingerprint do alerta, então problemas diferentes não se
colapsam num aviso só, e o mesmo problema substitui o anterior (§8).

⚠️ O que **não** dá para verificar por aqui é o iPhone real: o caminho do iOS foi
exercitado com um Safari simulado (sem `PushManager`), que prova a detecção e as
instruções, não a entrega da Apple. Isso só fecha com a Carol instalando o app.

### Notificações (§3, resolvido)

O canal é o **Web Push do próprio PWA**. Canais ligados hoje:

| Canal | Quando | Observação |
|---|---|---|
| `log` | sempre | é o piso: um alerta nunca se perde por falta de canal |
| `pwa-push` | com chaves VAPID | o canal escolhido; o service worker existe desde o passo 10 |
| `webhook` | com `NOTIFIER_WEBHOOK_URL` | sobra da decisão anterior, sem uso |

O `/health/sync` mostra **quais canais entregaram** (`avisadoPor`), não só que
tentou. `avisadoPor: "log"` sozinho significa que a notificação **não** chegou
ao celular.

A inscrição é atribuída ao **perfil da sessão**, não a um header do cliente:
antes vinha de `x-profile`, que o navegador escolhe, e qualquer um logado podia
inscrever o próprio celular no nome do outro e passar a receber os alertas dele.
É o mesmo princípio do §3 sobre o `?user=`.

⚠️ **iOS:** o Safari só entrega Web Push com o PWA **instalado na tela de
início** (16.4+). Aberto pelo navegador, não há inscrição e nada chega.
**A Carol usa iPhone e o HBUrso usa Android**, então o aviso de instalação na
tela de perfil é obrigatório no passo 10 — sem ele, ela nunca recebe alerta.

### Fila de revisão (§10)

| Rota | O quê |
|---|---|
| `GET /api/review` | a fila, com contagem por motivo para as pills de filtro |
| `GET /api/review/count` | só o número, para a badge da navegação |
| `GET /api/review/buscar?q=` | busca no TMDB, para a tela de "trocar" |
| `POST /api/review/:id/confirm` | aceita o candidato sugerido |
| `POST /api/review/:id/replace` | outro filme (`{"tmdbId":123}`) |
| `POST /api/review/:id/not-a-film` | é show, ópera, transmissão |
| `POST /api/review/:id/merge` | mesmo filme de outro Title (`{"toTitleId":"..."}`) |
| `POST /api/review/:id/dismiss` | é filme, mas o TMDB não tem — acréscimo ao §10 |

**Toda resolução reaponta o `TitleExternalId` do evento**, que é o cache do
estágio 0 do matching. Sem isso, o sync das 6h restauraria a decisão velha e o
trabalho da revisão sumiria. Há teste cobrindo exatamente isso.

Resolver a mesma pendência duas vezes devolve `409`, não repete a ação.

### Leitura do catálogo (§10)

As telas do passo 10 consomem estas rotas, acrescentadas junto com a home:

| Rota | O quê |
|---|---|
| `GET /api/home?user=` | hero + trilhas já agrupados — a home faz **uma** requisição |
| `GET /api/titles` | lista com filtros: `availability`, `tag` (repetível), `cinema`, `user`, `status`, `q` |
| `GET /api/titles/:id` | detalhe completo, com sessões agrupadas por cinema |
| `GET /api/sessions?titleId=&date=` | sessões por cinema, no fuso da cidade |
| `GET /api/cinemas` | cinemas ativos |
| `GET /api/tags?emCartaz=1` | facetas com contagem, agrupadas e com `id` qualificado (`sala:imax`) |
| `GET /api/users`, `GET /api/users/:id` | os dois perfis e suas cores |

O filtro por cinema é **por id do ingresso, nunca por nome** (§3): existe um
"Parque D. Pedro Shopping" que é espaço de eventos, não cinema.

### Passo 10 — frontend

| Tela | Estado |
|---|---|
| home mobile | pronta |
| home desktop | pronta — mesma home, coluna de 720 px, hero com altura limitada |
| revisar | pronta — fila, filtro por motivo e as resoluções |
| painel de tags | pronta — desliza da direita, seleção múltipla, grade de resultados |
| detalhe | pronta — metadata, sessões por cinema e dia, botão do ingresso.com |
| perfis | pronta — notificações, passo a passo do iOS e estado do sync |

**Decisão de 23/09/2026 (§3):** o desktop segue o mobile. O card horizontal de
pré-estreia do `desktop-catflix.html` está descartado — card de pôster único em
todas as trilhas, nos dois tamanhos. Telas sem modelo seguem o estilo das
existentes, sem propor layout antes.

Sobrou **um** controle desabilitado, com o motivo no `title`: a busca.

#### Painel de tags

Desliza da direita sobre a home escurecida, agrupado por faceta, com a contagem
por item e o item ativo no acento do perfil — o `mobile-tags.html`. Fecha no
toque fora, no X e no **Esc**.

Duas coisas que o modelo não decide e o código decidiu:

- **Seleção múltipla.** O modelo desenha uma tag só, mas o backend soma as tags
  com E (`?tag=sala:imax&tag=audio:legendado` = IMAX *e* legendado), e é essa a
  pergunta que se faz na frente do cinema. Cada item é `aria-pressed`, e um
  botão "Limpar" aparece quando há seleção.
- **Um cabeçalho "Tags"** que o modelo não tem — no modelo o X divide a linha
  com o rótulo do primeiro grupo. Com "Limpar" entrando na mesma linha, valeu
  mais dar um cabeçalho próprio ao painel. É a única divergência do modelo.

Com tag ligada a home **troca as trilhas por uma grade** de resultados, usando o
mesmo `PosterCard` (§12: um card só no app). Trilha rola de lado e esconde o
fim; aqui o fim é a resposta. As pills de disponibilidade continuam valendo e
viram `?availability=` na lista.

**A contagem do painel é a contagem da lista.** Verificado nas 13 facetas de
Campinas em 24/09/2026 e travado no teste
`modules/tags/tags.facetas.integracao.test.ts`. Antes não era: `GET /tags`
contava tudo que não fosse `merged` e a lista só mostra `matched` e `orphan`, de
modo que "IMAX 6" entregava 4 filmes — as outras duas eram ópera/transmissão já
marcadas como `not_a_film` na revisão.

**Tag no `?tag=` vai qualificada pela faceta** (`sala:imax`), não pelo slug
solto. O slug sozinho não é único entre facetas: hoje não há colisão no banco,
mas as tags manuais do passo 11 são texto digitado, e uma tag manual "IMAX"
passaria a casar também com a sala IMAX — o filtro **abriria** em silêncio. O
slug solto continua aceito, para não quebrar o que já estava documentado.

#### Detalhe do filme

Sem modelo de design; pela decisão de 23/09/2026 (§3), segue o estilo das telas
existentes em vez de propor layout antes. A ordem da página é a ordem da
decisão: o que é, se presta, onde passa, e só depois quem fez — sessão vem antes
de elenco porque o app existe para decidir ir ao cinema hoje.

Rota `/filme/:id`, aberta por qualquer card de trilha, pelo card da grade de
tags e pelo "Ver sessões" do hero. O voltar do Android volta para a home.

**O botão do §1 funciona** — ver "Link do ingresso.com" abaixo. Quando o título
não tem URL (órfão que nunca casou com evento do ingresso), o botão **some**, em
vez de levar a lugar nenhum. Medido em 24/09/2026: 158 dos 172 títulos visíveis
têm o botão.

**O tipo da sessão não é mostrado, de propósito.** `sessionKind` vem de
`inPreSale` (pendência 1): carimbaria "Pré-estreia" em quase toda sessão,
inclusive de filme já em cartaz. Melhor não dizer nada do que dizer errado. O
campo continua no tipo do frontend, com o aviso escrito nele.

**Três dias por cinema, com "Mais N dias".** O ingresso publica duas semanas de
grade e um filme popular chega a 160 sessões futuras — despejadas de uma vez,
empurram sinopse, tags e elenco para depois de uns quinze scrolls. Três dias
cobrem "vou hoje, amanhã ou no fim de semana?".

#### Lista completa de uma trilha

A trilha da home mostra no máximo 24 cards. O que passava disso **sumia do app**,
e como a ordem é por número de sessões, quem sumia era sempre o filme pequeno ou
o que está acabando — eram 8 filmes em cartaz em 24/09/2026.

Agora `GET /home` devolve o `total` de cada trilha, contado antes do corte, e a
home acende um **"Ver todos (N)"** no cabeçalho quando há mais. O mesmo botão se
repete como último cartão da esteira, com "+N": quem arrasta até o fim encontra a
saída onde já está olhando.

A rota `/lista/:trilha` abre a lista inteira numa página própria, com voltar no
topo e a mesma grade de pôsteres do painel de tags. Ela refaz a pergunta em
`GET /titles` em vez de pedir uma home sem corte — a home é uma requisição só,
montada para ser leve, e não faz sentido engordá-la por uma tela que quase nunca
é aberta. O mapeamento de trilha para filtro fica em `shared/api/trilhas.ts`,
num lugar só, porque as duas leituras têm de concordar.

#### Filtro de sessões por tipo de sala

No detalhe, pills acima das sessões: VIP, IMAX, XD, D-BOX, 3D, Comum… A contagem
ao lado de "Sessões" passa a mostrar `54 de 115` enquanto o filtro está ligado, e
tocar na pill ativa volta a mostrar tudo.

Duas decisões:

- **Os formatos saem das sessões DESTE filme**, não da lista global. Oferecer
  "IMAX" num filme que não passa em IMAX seria um filtro que só sabe devolver
  vazio, e as pills só aparecem quando há mais de um formato para escolher.
- **Sala comum entra como "Comum".** O backend manda `sala: null` para ela,
  porque escrever "Normal" em cada horário só ocuparia espaço — mas no filtro
  ela precisa de nome: "só as comuns" é justamente o que se pede para não pagar
  VIP.

Cinema que fica sem nenhuma sessão do formato escolhido sai da lista; um nome de
cinema com nada embaixo parece defeito.

### PWA

O app instala na tela de início e abre sem a barra de endereço. É o que o §3
exige para a Carol receber notificação: no iPhone o Safari só entrega Web Push
com o app **instalado**.

| Peça | Onde |
|---|---|
| manifest | `public/manifest.webmanifest` — `standalone`, tema `#0B0A0F` |
| ícones | 192 e 512 `any`, mais um 512 `maskable` |
| service worker | `public/sw.js` — push e cache do esqueleto |
| registro | `src/shared/pwa.ts`, no boot |
| convite (Android) | `useInstalacao`, na tela de perfil |
| passo a passo (iOS) | tela de perfil, no bloco de notificações |

**O ícone `maskable` é um arquivo separado, e precisa ser.** O Android recorta o
ícone em círculo ou squircle e só garante os 80% centrais; a logo ocupa 100% do
quadrado, então as orelhas do gato e a fita seriam cortadas. O maskable põe a
arte em 72% e completa com a cor do próprio canto da logo (`#030406`) — usar o
`$bg` do tema (`#0B0A0F`) deixava a emenda do quadrado visível dentro do ícone.

⚠️ O maior original disponível é 256×256 (`Icon/Logo.ico` também só tem 256), então
o 512 é ampliado. Funciona, mas um 512 de origem ficaria mais nítido na splash
do Android.

#### O que o service worker cacheia — e o que nunca

**Isto reverte a decisão anterior de "não cachear nada", e a distinção é a
razão:**

- O **esqueleto** — HTML, JS, CSS, ícones — é cacheado. Ele não fala sobre
  cinema nenhum: é a casca que sabe desenhar telas e dizer "não consegui falar
  com o servidor".
- Os **dados** — tudo em `/api` — continuam **nunca** cacheados. Uma grade de
  sessões velha servida como se fosse a de hoje mandaria a Carol para o cinema
  na hora errada. Quem responde "a API caiu" é o backend, com a idade do dado à
  vista (§8) — e para isso ele precisa ser perguntado.

Não há regra geral de cache no `sw.js`: há uma **lista do que pode**. O que não
está nela passa direto para a rede, e é assim que `/api` fica de fora por
construção, não por lembrança. Em desenvolvimento isso também protege o Vite —
verificado: nenhum módulo de `/src` ou `/@vite` entra no cache.

Navegação é rede-primeiro com o cache de reserva: um deploy novo aparece na hora
quando há sinal, e sem sinal o app abre em vez da página de erro do navegador.

#### Dois defeitos que só apareceram testando o build

Os dois davam **tela branca** no app instalado sem sinal, e nenhum aparecia em
desenvolvimento:

1. **Na primeira visita o service worker ainda não controla a página.** O
   navegador já baixou o JS e o CSS antes de ele existir, então eles não passavam
   pelo `fetch` dele e não eram guardados. Quem instalasse e perdesse o sinal
   antes de abrir uma segunda vez não tinha esqueleto nenhum. Agora o `install`
   lê o `index.html` e guarda os `/assets/` que ele referencia — ler o HTML em vez
   de listar nomes porque o Vite põe hash em cada bundle e o `sw.js` é servido
   cru, sem saber os nomes da build de hoje.

2. **`Vary: Origin`.** O pedido que o service worker faz para encher o cache sai
   em modo `cors` e leva `Origin`; o que a página faz por um
   `<link rel="stylesheet">` sai em `no-cors` e não leva. Sem `ignoreVary`, o
   `caches.match` considerava os dois diferentes, não achava nada e caía para a
   rede — com o arquivo guardado ali do lado.

#### Entrar sem servidor

O app instalado abre do cache, mas **entrar depende do servidor**. Antes a tela
de login mostrava "Quem está entrando?" com a lista de perfis vazia e nenhuma
explicação. `useSessao` passou a distinguir "deslogado" de "não consegui nem
perguntar" (`semServidor`), e o login diz o que houve com um "Tentar de novo"
que refaz a consulta sem recarregar a página.

#### Testado no build, não em dev

Service worker só faz sentido sobre os assets com hash, então a verificação foi
com `npm run build` + `npm run preview`. Para isso o `vite.config.ts` ganhou
`preview.proxy`: **`preview` tem config própria e não herda a de `server`**, e
sem ele todo `/api` dava 404 no teste de produção local.

Medido em 25/09/2026, com perfil de navegador limpo e **uma** visita só: o cache
fica com `/`, os dois assets com hash, os ícones e o manifest — e **nada** de
`/api`. Cortando a rede, o app abre no tema escuro com a mensagem de servidor
inalcançável. O Chrome disparou o `beforeinstallprompt`, o que confirma que o
app atende aos critérios de instalação.

### Link do ingresso.com (§1)

`TitleExternalId.sourceUrl` guarda o `movies[].siteURL` do CONTRATO.md §4.3.
Fica no id externo, e não em `Title`, porque é a URL **daquele evento** do
ingresso — o mesmo filme tem uma página por evento. `GET /titles/:id` devolve a
do id atualizado mais recentemente, que é a que tem o slug certo quando o
ingresso renomeia o filme.

Migration `20260924..._title_external_id_source_url`: uma coluna nullable, nada
destrutivo (§6). O `upsert` do sync **atualiza só a URL** — reescrever `method`
ali apagaria um `manual` vindo da revisão no sync seguinte.

Um evento visto antes de 24/09/2026 só ganha a URL no sync seguinte; até lá o
botão some. Eventos que o ingresso não lista mais nunca ganham, e é por isso que
o campo continua nullable.

### Marcações e tags manuais (§10, passo 11)

| Rota | O quê |
|---|---|
| `PUT /api/users/:userId/titles/:titleId/state` | `{"status":"quero_ver"\|"marcado"\|"visto"}` |
| `DELETE /api/users/:userId/titles/:titleId/state` | desmarcar — acréscimo ao §10 |
| `POST /api/titles/:id/tags` | `{"tag":"maratona"}`, só tag manual |
| `DELETE /api/titles/:id/tags/:tagId` | só tag manual, e só a sua |
| `GET /api/tags/minhas` | o vocabulário de quem está logado |

**`:userId` tem de ser o perfil da sessão.** O §3 já dizia isso do `?user=`; o
parâmetro de rota é o mesmo problema por outro caminho, e sem a checagem trocar
o id na URL marcaria filme no nome do outro. Testado: devolve 400.

**O sync nunca toca em tag manual.** É a linha mais fácil de quebrar sem
perceber, porque todo o recálculo de tags é `deleteMany` + `create` — basta um
`deleteMany` perder o filtro `origin: 'auto'` para o trabalho das duas pessoas
sumir sem nenhum teste acusar. Coberto por
`modules/tags/tags.manuais.integracao.test.ts`, e verificado contra um sync real
em 24/09/2026: a tag e a marcação continuaram lá depois do job de sessões.

**A tag é de quem escreveu.** Os dois podem ter "maratona" no mesmo filme sem
uma virar a da outra pessoa, e só o dono remove. No detalhe, a tag do outro
perfil aparece com borda tracejada e sem o ×.

**Tirar uma tag do filme não apaga a tag.** Ela é o vocabulário da pessoa e some
sozinha das telas, porque `listarFacetas` só conta tag com título. Apagá-la faria
"maratona" desaparecer do banco por ter sido tirada de um filme por engano.

**As três datas do §6 são histórico, não espelho do status.** "Quero ver" em
março e "visto" em maio: as duas ficam, e nenhuma é apagada na transição. É o
que permite responder quanto tempo ela esperou por um filme — e o que o §13 vai
usar quando o "visto" começar a chegar por webhook do Jellyfin. A origem fica
gravada como `app`, para distinguir do que vier de fora.

**Desmarcar apaga a linha**, em vez de guardar um quarto status "nenhum" que
apareceria em toda consulta que filtra por estado.

Na home, o botão "Marcar com o Urso / com a Gata" do hero **leva ao detalhe** em
vez de gravar direto: lá a pessoa vê os três estados, o que já está marcado e
como desfazer. Um toque que grava da home tornaria "marquei sem querer" um beco
sem saída.

## Pendências conhecidas

Uma coisa que a implementação atual **não** resolve. Não foi contornada em
silêncio; está comentada no código onde dói.

**1. `Session.sessionKind` marca pré-estreia demais.** O parser deriva o tipo da
sessão de `movies[].inPreSale`, que no ingresso significa **pré-venda** (bilhete
já à venda), não pré-estreia (sessão antes da estreia oficial). Medido em
23/09/2026: **434 das 504 sessões futuras** estão gravadas como `pre_estreia`, e
os 13 títulos em cartaz têm todos pelo menos uma. A leitura da home contorna
isso usando `Availability`, e **o detalhe não mostra o tipo da sessão** por
causa disto — melhor não dizer nada do que carimbar "Pré-estreia" em tudo. O
campo continua errado no banco. A correção honesta é reclassificar depois do
matching, comparando `Session.startsAt` com `Title.releaseDate` — o parser
sozinho não tem essa data.

**Testes que precisam do Postgres:** os de integração (`*.integracao.test.ts` e
o de trigrama) se anunciam como pulados quando o banco não responde, em vez de
dar falso verde. Eles criam dados com o prefixo `__teste__` e limpam depois.
#   C a t F l i x  
 