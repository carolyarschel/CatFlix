# Cineon — Expansão: catálogo do casal (filmes assistidos e lista "quero assistir")

> Documento de contexto para o Claude Code. Ele **complementa** o `contexto.md` original do app. Leia os dois inteiros antes de qualquer tarefa.
> Quando os dois documentos discordarem, **este vale**.
> **[PENDENTE]** = ainda não decidido. Pergunte à Carol antes de implementar e não assuma nada.
> **[ASSUMIDO]** = decisão tomada por padrão. Implemente assim, mas cite o ponto quando apresentar o schema, porque a Carol pode mudar.
> **[VERIFICAR]** = confira o nome exato do campo ou endpoint na documentação oficial (TMDB, JustWatch) antes de usar. Não invente.

---

## 0. Como trabalhar nesta expansão

1. **O app já existe e funciona.** Hoje ele pega os filmes do ingresso.com, mostra o que está em cartaz, as pré-estreias e os próximos lançamentos, e deixa escolher uma sessão e ir para a compra do ingresso. **Nada disso pode quebrar nem sumir.**
2. **Antes de qualquer código**, leia o código e o `schema.prisma` atuais e escreva um `ESTADO_ATUAL.md` curto com:
   - o que já existe;
   - o que diverge do `contexto.md` original;
   - o que precisa mudar para atender este documento.
3. Depois, apresente **as mudanças no `schema.prisma`** e espere a Carol aprovar.
4. **As migrations só podem somar ao schema.** Nada de apagar ou renomear colunas que têm dados. Se uma mudança destrutiva for inevitável, pare e explique o motivo antes.
5. Implemente módulo por módulo, na ordem da seção 12.
6. Stack, convenções, ambiente (Windows + PowerShell, sem Docker, deploy no Catploy) e tokens de design continuam os do `contexto.md` original.

---

## 1. O que muda no conceito

O Cineon deixa de ser só "o que está passando no cinema" e passa a ser **o registro de tudo o que a Carol e o namorado assistem e querem assistir**. A expansão desta fase cobre só filmes.

| Parte | Fonte | Situação |
|---|---|---|
| **Cinema:** em cartaz, pré-estreias, em breve, sessões, compra | ingresso.com + TMDB + OMDb | **Já existe. Manter como está.** |
| **Assistidos:** todo filme que vocês já viram, no cinema ou em casa | TMDB + registro manual | **Novo** |
| **Quero assistir:** filmes que vocês querem ver, lançados ou não | TMDB + registro manual | **Novo** |
| **Detalhe do filme:** igual ao do Crônicas de Gatur atual, para qualquer filme | TMDB | **Novo** (antes não tinha modelo) |

As duas partes usam o **mesmo `Title`**. A chave canônica continua sendo o `tmdb_id`. Um filme que entrou pelo ingresso e depois foi registrado como assistido é **um registro só**, nunca dois.

**Fora desta fase** ([PENDENTE], próxima expansão): séries e animes. A Carol já decidiu que eles vão entrar no Cineon. Não implemente nada para eles agora, mas também não tome decisões que dificultem essa entrada:
- `Title.mediaType` já existe;
- o progresso de série (temporadas e episódios) vai ter um modelo próprio no futuro, então não generalize a `Visualizacao` para episódios.

---

## 2. Decisões da Carol (não questionar)

- Manter todas as funcionalidades atuais do cinema.
- Ter no app **todos os filmes que vocês já assistiram**, não só os do cinema, com os metadados do TMDB.
- Ao clicar no card de um filme, abrir o detalhe com **as mesmas informações do CG atual** (seção 7). O print de referência está em `design/detalhe-referencia-cg.png`.
- **Para todo filme** aparecem: diretor, estúdios, elenco principal e sinopse.
- O botão **"Onde assistir"** abre a página do filme no **JustWatch** (seção 6).
- Ao registrar que assistiu, dá para marcar **onde** (em casa ou no cinema) e **a data**.
- Dá para colocar filmes na lista **"quero assistir"**, tenham estreado ou não.

Decisões que vêm do ecossistema Gatur e também valem aqui (seção 10):
- Participantes são `CAT` (Carol) e `BEAR` (o namorado). "CatFlix" e "HBUrso" passam a ser só **apelidos de exibição**.
- **Nota de 0 a 10, com meio ponto**, uma por pessoa. É a mesma escala de todos os apps do ecossistema.
- **Apagar só marca como removido** (`removidoEm`), nunca apaga a linha de verdade.
- Toda tabela que vai para o feed do Crônicas de Gatur tem `atualizadoEm`.

---

## 3. Modelo de dados (conceitual — transformar em mudanças no `schema.prisma` e apresentar)

Use os nomes que já existem no código. Esta seção define **o que** precisa existir, não o nome exato da tabela.

### 3.1 O que muda no catálogo

- **`Title`** ganha:
  - `sinopse` com fallback de idioma (seção 5.2);
  - `dataEstreiaBR` e `dataEstreiaOriginal`, as duas podendo ser nulas;
  - `statusProducao`, com os valores do TMDB (`Rumored`, `Planned`, `In Production`, `Post Production`, `Released`, `Canceled`) **[VERIFICAR]**;
  - `metadataAtualizadaEm`;
  - `justwatchUrl`, que pode ser nulo (seção 6).
- **Créditos:** `Person` e `TitleCredit` já existem no modelo original. Confira se o código guarda:
  - a **foto** da pessoa (`profile_path`);
  - o **personagem** (`character`). É o "Rillie Doe (voice)" do print;
  - a **ordem** no elenco.

  Se faltar algum desses campos, acrescente.
- **Estúdios:** `Company` e `TitleCompany` já existem. Confira se estão sendo preenchidos.
- **`ProvedorStreaming`** e **`TitleProvedor`** (opcionais, seção 6): onde o filme está disponível no Brasil, segundo o TMDB/JustWatch. Cada registro tem tipo (`flatrate`, `rent`, `buy`, `free`, `ads`) e `atualizadoEm`.

### 3.2 Entidades novas

| Entidade | Campos principais | Regras |
|---|---|---|
| **Visualizacao** | `titleId`, `data`, `precisaoData` (`DIA`/`MES`/`ANO`), `local` (`CASA`/`CINEMA`), `participantes` (`CAT`, `BEAR` ou os dois), `cinemaId?`, `cinemaNomeLivre?`, `tipoSala?`, `observacao?`, `removidoEm?`, `atualizadoEm` | Um filme pode ter **várias** (rever conta). `participantes` nunca vazio. `cinemaId` só quando `local = CINEMA`. É ele que liga ao `Cinema` do ingresso; para cinema que não está na base, usa `cinemaNomeLivre`. Datas antigas aceitam precisão de mês ou ano. |
| **QueroAssistir** | `titleId`, `pessoa` (`CAT`/`BEAR`), `adicionadoEm`, `interesse?` (1–5), `removidoEm?` | Uma linha por pessoa e por filme. "Os dois querem" **não é gravado**: é calculado quando existem as duas linhas. **[ASSUMIDO]** As estrelas de "Marque seu interesse" do print viram o `interesse` de cada pessoa. |
| **Avaliacao** | `titleId`, `pessoa`, `nota` `Decimal(3,1)`, `atualizadoEm` | Valida de 0 a 10 em passos de 0,5. Única por filme e pessoa. Só pode ser dada se essa pessoa participou de alguma `Visualizacao` do filme. |

### 3.3 Status de um filme para cada pessoa (derivado, nunca gravado)

- **Assistido:** existe uma `Visualizacao` ativa com essa pessoa como participante.
- **Quero assistir:** existe uma linha ativa em `QueroAssistir` para essa pessoa.
- **[ASSUMIDO]** Registrar uma `Visualizacao` **tira o filme da lista "quero assistir" dos participantes** (marca `removidoEm`). A tela avisa com "Removido da sua lista" e um botão de desfazer.

### 3.4 O que fazer com o `UserTitleState` atual

O modelo original tinha `UserTitleState` com os valores `quero_ver`, `marcado` e `visto`.
- `quero_ver` passa a ser `QueroAssistir`.
- `visto` passa a ser `Visualizacao`. Como não tem data nem local, a migração **pergunta** em vez de inventar. **[PENDENTE]** Confirme com a Carol se existem dados reais nessa tabela.
- `marcado` (do botão "Marcar com o Urso") **[PENDENTE]**: veja no código o que ele faz hoje e pergunte se ele continua, vira `QueroAssistir` ou sai.

Não apague o `UserTitleState` na mesma migration. Migre os dados primeiro, confira e só depois proponha remover.

### 3.5 Filmes que não estão no TMDB

Isso é raro, principalmente com filmes anunciados há muito pouco tempo. Nesses casos, aceite criar o `Title` como `orphan`, só com o título, para que ele possa entrar na lista "quero assistir". Ele aparece com "metadata pendente" e entra na fila **Revisar** que já existe (motivo `no_candidate`). Lá, a Carol liga o filme ao TMDB quando ele existir. Use o mesmo `mergeTitles` do contexto original.

---

## 4. Fluxos

### 4.1 Adicionar um filme (botão "+" no cabeçalho)

1. Busca no TMDB (`search/movie`, `language=pt-BR`), com debounce. Cada resultado mostra pôster, título, ano e diretor.
2. Ao escolher um resultado, o backend cria o `Title` a partir do `tmdb_id`, ou reaproveita o que já existe. **Nunca duplica**, mesmo que o filme tenha entrado antes pelo ingresso.
3. O usuário escolhe uma destas opções:
   - **"Já assistimos":** abre o formulário de visualização (data, casa ou cinema, quem estava, cinema e sala se for no cinema);
   - **"Quero assistir":** adiciona à lista da pessoa logada, com a opção "nós dois";
   - **só abrir o detalhe.**
4. Não existe "nenhum resultado, cria assim mesmo" no fluxo normal. Criar sem TMDB fica num link discreto ("Não encontrei o filme"), que leva para a seção 3.5.

### 4.2 Registrar que assistiu a partir do cinema

No detalhe de um filme em cartaz, o botão "Já assistimos" abre o formulário já preenchido com `local = CINEMA` e a data de hoje. A lista de cinemas vem dos `Cinema` que já existem.

### 4.3 Quando um filme da lista entra em cartaz

Se um filme está na lista "quero assistir" e passa a ter `Availability` `cinema:em_cartaz` ou `cinema:pre_estreia`, ele ganha o selo **"Na sua lista"** nas trilhas do cinema e aparece primeiro na trilha "Quero assistir". Isso é só uma consulta, não grava nada nem precisa de job novo.

### 4.4 Remover do catálogo

O botão "Remover do catálogo" (vermelho e com contorno, como no print) pede confirmação. Ao confirmar, ele marca `removidoEm` em todas as visualizações, entradas da lista e avaliações daquele filme. **O `Title` não é apagado**, porque pode continuar em cartaz. Mantenha a possibilidade de desfazer até a página ser recarregada.

---

## 5. TMDB: o que buscar e como

### 5.1 Detalhe

Use `GET /movie/{id}` com `append_to_response=credits,external_ids,release_dates,images,watch/providers` **[VERIFICAR o nome exato do append de watch providers]**:

- **Diretor:** `credits.crew` com `job = "Director"`. Pode ter mais de um. Mostre todos, separados por vírgula.
- **Elenco principal:** `credits.cast` ordenado por `order`, os **10 primeiros**. Cada um com nome, personagem e foto (`profile_path`). Sem foto, mostre as iniciais.
- **Estúdios:** `production_companies`.
- **Gêneros:** `genres`, com os nomes em pt-BR.
- **Estreia:** em `release_dates`, procure o país `BR`, com tipo cinema (3) ou, se não houver, limitado (2) **[VERIFICAR os códigos]**. Se não tiver data do Brasil, use `release_date` e mostre "Estreia (mundial)".
- **IDs externos:** `imdb_id`, porque o OMDb continua buscando as notas por ele.

### 5.2 Idioma e fallback

- Peça tudo com `language=pt-BR`. **Muita sinopse em pt-BR vem vazia no TMDB.** Nesse caso, busque `language=en-US` e mostre a sinopse em inglês, com um selo discreto "sinopse em inglês". Nunca deixe o bloco vazio sem explicação.
- Título: pt-BR. Se não houver, use `original_title`.
- Filmes ainda não lançados podem vir sem sinopse, sem elenco e sem data. A tela precisa funcionar com qualquer um desses campos faltando.

### 5.3 Atualização dos metadados

- Filme **ainda não lançado** ou lançado há **menos de 90 dias**: atualizar a cada 7 dias. Elenco, sinopse e data mudam muito nessa fase.
- Os outros: a cada 90 dias. O de 30 dias do contexto original era pensado para o cinema e fica desperdiçado num acervo de centenas de filmes antigos.
- **Notas do OMDb nos filmes do acervo:** mensal para filmes com mais de 1 ano e a regra original para os outros. O limite de 1.000 chamadas por dia continua valendo, então o job precisa respeitar uma cota diária configurável.

### 5.4 Atribuição obrigatória

- **TMDB:** o logo e o aviso "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB" numa tela "Sobre" ou no rodapé do menu "Mais".
- **JustWatch:** se o app mostrar provedores de streaming vindos do TMDB, o TMDB exige atribuir esses dados ao JustWatch, sob pena de revogar o acesso à API. Coloque "Dados de streaming: JustWatch" junto da lista de provedores.

---

## 6. "Onde assistir" → JustWatch

**A limitação:** o JustWatch não tem API pública gratuita. A API de parceiros exige um token comercial. O endereço da página de um filme usa um slug de texto (`https://www.justwatch.com/br/filme/<slug>`) que **não dá para montar** a partir do `tmdb_id`. Já o link que o TMDB devolve em `watch/providers` aponta para a página do **próprio TMDB**, não para a do JustWatch.

**O que fazer [ASSUMIDO]:**
1. Se o filme tem `justwatchUrl` salvo, o botão abre esse endereço direto.
2. Se não tem, o botão abre a **busca do JustWatch Brasil** pelo título original e o ano. O endereço exato da busca está **[VERIFICAR]**; confirme acessando o site. A pessoa clica no resultado certo.
3. No "Editar" do filme existe um campo "Link do JustWatch". A Carol cola o endereço uma vez e, daí em diante, o botão vai direto para a página.
4. Opcional, se der tempo: no detalhe, mostrar os logos dos serviços em que o filme está disponível no Brasil (`watch/providers`, região `BR`), com a atribuição da seção 5.4. Isso responde "onde assistir" sem precisar sair do app.

**Não fazer:** scraping ou uso da API GraphQL interna do JustWatch para descobrir o slug. Quebra sem aviso e fere os termos de uso do site.

---

## 7. Tela de detalhe do filme

A referência é o print `design/detalhe-referencia-cg.png`, uma tela do Crônicas de Gatur atual. Copie **a estrutura e a ordem das seções**, com os **tokens de design do Cineon** (seção 12 do contexto original). As cores do print são as do CG e não valem aqui.

De cima para baixo:

1. **Pôster/backdrop** no topo.
2. **Chips de estado:** tipo (`FILMES`) e status para a pessoa logada (`Quero assistir` / `Assistido`), mais as **tags manuais** do filme. No print aparecem "De bisnaguinha" e "De crédito". **[PENDENTE]** Pergunte à Carol o que essas tags significam e se viram tags manuais comuns ou um campo próprio.
3. **Título** grande e linha **"Dir. Nome"**.
4. **ESTÚDIOS:** chips.
5. **SINOPSE:** com o selo de idioma da seção 5.2, quando for o caso.
6. **ELENCO PRINCIPAL:** rolagem horizontal, foto redonda, nome em negrito e personagem embaixo.
7. **GÊNEROS:** chips.
8. **Estreia:** data no formato `26/11/2026`.
9. **Notas IMDb/RT:** marcadores do contexto original, quando houver.
10. **Bloco da pessoa:**
    - se ainda não assistiu: estrelas de **interesse** ("Marque seu interesse");
    - se já assistiu: **nota** de 0 a 10 de cada um, 🐱 e 🐻.
11. **"Assistimos":** lista das visualizações (data, 🏠 casa ou 🎬 cinema com nome e sala, indicador de quem assistiu) e o botão **"Registrar que assistimos"**.
12. **Se estiver em cartaz:** o bloco de sessões que já existe e o botão para o ingresso.com.
13. **Ações:**
    - **Editar** (contorno);
    - **Onde assistir** (contorno com o acento secundário);
    - **Remover do catálogo** (contorno vermelho, sozinho numa linha).

**Indicador de quem assistiu:** usa as cores dos perfis. Só Carol = acento CatFlix; só ele = acento HBUrso; os dois = os dois círculos sobrepostos. Não invente uma terceira cor.

Proponha o layout desktop antes de implementar, porque o print é só mobile.

---

## 8. Navegação e telas novas

**[ASSUMIDO]**, apresente antes de implementar. Barra inferior no mobile e sidebar no desktop:

| Item | Conteúdo |
|---|---|
| **Cinema** | A home atual, com as pills Em cartaz / Pré-estreias / Em breve. Sem mudanças. |
| **Assistidos** | Grade de pôsteres, os mais recentes primeiro. Filtros: ano em que assistiram, casa/cinema, quem assistiu, gênero, diretor, nota. Busca por título. |
| **Quero assistir** | Trilhas: "Em cartaz agora", "Estreia em breve" (ordenado por data), "Já disponível", "Sem data". Filtro: minha / dele / dos dois. |
| **Mais** | Revisar (com o selo de pendências, regra original), configurações, "Sobre" com as atribuições. |

O botão **"+"** fica no cabeçalho de todas as telas (fluxo 4.1). Todos os cards de pôster continuam **idênticos** (regra do `PosterCard` original). Muda só o conteúdo, por exemplo a data em que assistiram numa faixa no rodapé.

---

## 9. API (acréscimos)

Mantenha os prefixos e o estilo da API que já existe. Os acréscimos:

```
GET    /tmdb/search?q=                         # proxy; a chave nunca vai ao frontend
POST   /library/titles          { tmdbId }     # cria ou reaproveita o Title e enriquece
GET    /library/titles/:id                     # detalhe agregado (seção 7)
PATCH  /library/titles/:id      { justwatchUrl, tags }
DELETE /library/titles/:id                     # "remover do catálogo" (seção 4.4)

GET    /watches?pessoa&local&ano&cursor        # Assistidos
POST   /titles/:id/watches
PATCH  /watches/:id             DELETE /watches/:id

GET    /watchlist?escopo=CAT|BEAR|AMBOS
PUT    /titles/:id/watchlist    { interesse? } # da pessoa logada
DELETE /titles/:id/watchlist

PUT    /titles/:id/rating       { nota }       # da pessoa logada
GET    /titles/:id/where-to-watch              # justwatchUrl ou URL de busca + provedores BR
```

`library` é um **módulo orquestrador**: depende de `catalog`, `tmdb`, `watches`, `watchlist` e `ratings`. Nenhum desses depende dele, e eles também não dependem uns dos outros. O módulo `tmdb` continua sendo só cliente de fonte e não conhece o catálogo.

---

## 10. Integração ao ecossistema Gatur

### 10.1 Login pelo Portão de Gatur

- O ecossistema agora tem login único pelo **Portão de Gatur** (`portao.gatourso.com`), com **OAuth no padrão BFF**. O backend do Cineon é o cliente OAuth, e o frontend nunca vê token. Use o pacote compartilhado **`gatur-portao-client`**, que monta `/auth/entrar`, `/auth/callback` e `/auth/sair` e o middleware de sessão.
- O `User` local vira **espelho** do usuário do Portão: o `sub` vira o id, e o `papel` (`CAT`/`BEAR`) define o tema. `CAT` → tema CatFlix, `BEAR` → tema HBUrso. Os dois apelidos ficam só para exibição.
- O contexto original já previa autenticação atrás de um middleware isolado. Troque só a implementação dele.
- **[PENDENTE]** Faça isso nesta fase só se o `gatur-portao-client` já estiver pronto. Se não estiver, mantenha o login atual e deixe a troca para depois.

### 10.2 Feed para o Crônicas de Gatur

O CG vai montar a timeline do casal puxando dados deste app. Exponha o **Contrato de Feed v1** (especificado no `contexto.md` do CG):

```
GET /gatur-feed/v1/eventos?desde=<ISO>&cursor=<opaco>      # token de serviço do Portão
```

- **Cada `Visualizacao` vira um evento pontual** do tipo `filme.assistido`, com:
  - data e precisão;
  - participantes;
  - local (casa ou cinema);
  - a obra: título, `tmdb_id`, `imdb_id` e duração, que alimenta a estatística de tempo de filme no CG;
  - as notas dos dois, copiadas.
- Mudar uma nota **reenvia** todas as visualizações daquele filme, senão o CG fica com a nota antiga.
- `removidoEm` sai no feed como `removido: true`.
- **A lista "quero assistir" não vai para o feed.** A timeline é do que aconteceu.
- Esta parte pode ser a última da fase. O CG é o último app a ser construído.

**Feito em 23/11/2026** (`backend/src/modules/feed/`, tipos do contrato copiados do CG em `feed.types.ts`):
- **Categoria pelo local**, e não `filme.assistido`: `CINEMA` → `filme.cinema`, `CASA` → `filme.casa`, as categorias já combinadas no contexto do CG (seção 7 dele). O local vai na própria categoria.
- `idNaFonte = watch:<id>`; `inicio`/`precisaoInicio` = `watchedOn` **sem hora** (`"AAAA-MM-DD"`: como instante, a meia-noite UTC cairia no dia anterior no CG)/`datePrecision`; `participantes` = `participants`.
- Obra: `title`, `originalTitle` (só se diferente), `year`, `posterUrl`, ids `TMDB`/`IMDB`, `totais.duracaoMin` = `runtimeMinutes` (o "tempo de filme" do CG sai daí) e `metadados.generos` (para a retrospectiva do CG).
- Notas: as `Rating` não removidas de cada pessoa, `escalaMax: 10`, com o `Comment` dela junto. Comentário sem nota não vai (o contrato exige `valor`).
- `atualizadoEm` = o maior entre a visualização, o título, as notas e os comentários do filme (calculado no SQL). Paginação: `desde` inclusivo + cursor opaco; `limite` padrão 100, máximo 500; parâmetro inválido → 400.
- Série (hoje não existe): obra `SERIE`, sem categoria, até o CG definir as de série.
- Rota `GET /api/gatur-feed/v1/eventos`, montada **antes** do `exigirPerfil`, protegida por `portao.exigirServico('feed:read')` (`gatur-portao-client` v0.2.0). `aud` = `PORTAO_RECURSO` (padrão: `PORTAO_URL_DO_APP` em produção). Sem Portão ligado ou, em dev, sem `PORTAO_RECURSO`, o feed responde `503 FEED_SEM_CONFIGURACAO` e o resto do app sobe normal.
- **No Portão:** `npm run app:registrar -- --slug cineon --expoe-feed` (e `-- --slug cg --le-feed`).
- Testado de ponta a ponta com o banco de dev (só leitura): Portão local → este feed → sync do CG. As 97 visualizações passam na validação do CG, a paginação de 10 em 10 bate com a página única e o sync criou 96 eventos (1 foi para a revisão do CG, por título parecido sem ID externo). Testes de unidade em `feed.service.test.ts`.

---

## 11. Histórico dos filmes já assistidos

**[PENDENTE]** A Carol quer **todos** os filmes que vocês já viram. Esse histórico está hoje no **Crônicas de Gatur antigo**. Antes de implementar, pergunte:
1. Importar para o Cineon os filmes da timeline do CG antigo? A Carol tem o schema e o dump.
2. Existe outro registro (planilha, Letterboxd)?

Se houver importação, siga o mesmo padrão do import de CSV da Biblioteca de Gatur:
- um script em `backend/scripts/`;
- busca no TMDB por título e ano;
- os casos com confiança alta entram direto;
- o resto vai para a fila **Revisar**, com o motivo `import_low_confidence`.

Datas incompletas usam `precisaoData`. Quem participou: no CG antigo, rosa é a Carol, azul é ele e roxo são os dois.

---

## 12. Ordem de implementação

1. `ESTADO_ATUAL.md` e as mudanças no `schema.prisma`. **Apresentar e esperar aprovação.**
2. Migrations, só somando. Migração de dados do `UserTitleState` (seção 3.4), só depois das respostas da Carol.
3. Módulo `tmdb`: busca, detalhe com `append_to_response`, fallback de idioma, estreia BR e testes com respostas reais salvas.
4. Backend: `watches`, `watchlist`, `ratings`, e depois o orquestrador `library`.
5. Job de atualização de metadados e notas do acervo (seção 5.3).
6. Frontend:
   1. fluxo "+" (busca e adicionar);
   2. **detalhe novo** (propor o layout desktop antes);
   3. Assistidos;
   4. Quero assistir;
   5. selo "Na sua lista" nas trilhas do cinema.
7. "Onde assistir" (seção 6) e a tela "Sobre" com as atribuições.
8. Importação do histórico, se a Carol aprovar.
9. Login pelo Portão (seção 10.1), se o pacote estiver pronto.
10. Feed para o CG (seção 10.2). **Feito em 23/11/2026.**

---

## 13. Variáveis de ambiente (acréscimos)

```
TMDB_LANGUAGE=pt-BR
TMDB_FALLBACK_LANGUAGE=en-US
TMDB_REGION=BR
OMDB_DAILY_QUOTA=900
JUSTWATCH_SEARCH_URL=        # [VERIFICAR] endereço da busca do JustWatch Brasil
PORTAO_ISSUER=https://gate.gatourso.com/api/auth
PORTAO_CLIENT_KEY=
PORTAO_CLIENT_SECRET=
PORTAO_RECURSO=https://cineon.gatourso.com   # aud do token de serviço do feed do CG (obrigatória em dev para o feed)
```

---

## 14. O que NÃO fazer

- Não mexer no fluxo de cinema (sync do ingresso, matching, canaries, revisão), a não ser para reaproveitar `Title`/`mergeTitles` e acrescentar motivos à fila Revisar.
- Não criar um segundo `Title` para um filme que já existe com o mesmo `tmdb_id`, nem uma segunda tabela de filmes "do acervo".
- Não gravar o status "assistido" nem "os dois querem". São sempre calculados.
- Não chamar o TMDB nem o OMDb a partir do navegador.
- Não fazer scraping do JustWatch.
- Não implementar séries nem animes nesta fase.
- Não usar as cores do CG do print. Usar os tokens do Cineon.

---

## 15. Critérios de aceite

- Todas as funcionalidades de cinema continuam funcionando como antes.
- Adicionar pelo "+" um filme que já está em cartaz reaproveita o `Title` existente.
- Um filme pode ter várias visualizações, com local, data e participantes diferentes.
- Todo filme do acervo mostra diretor, estúdios, elenco principal com foto e personagem, e sinopse, ou explica a ausência (filme não lançado, sinopse só em inglês).
- Um filme sem data de estreia pode ser adicionado à lista "quero assistir".
- Registrar uma visualização tira o filme da lista dos participantes, com opção de desfazer.
- "Onde assistir" abre a página do JustWatch quando há `justwatchUrl`, e a busca do JustWatch quando não há.
- "Remover do catálogo" não apaga o `Title` nem afeta as sessões de cinema.
- As atribuições do TMDB (e do JustWatch, se houver provedores) aparecem no app.
