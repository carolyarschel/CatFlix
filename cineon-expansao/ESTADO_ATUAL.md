# Estado atual do Cineon e mudanças propostas para a expansão

Escrito em 18/11/2026, a partir do código em `main` (`b16d6bd`), do banco de
desenvolvimento e do projeto `cineon` no Catploy. É o passo 1 da seção 12 de
`contexto-expansao.md`. **Nada do schema foi alterado ainda.** A seção 4 é a
proposta, que espera aprovação.

---

## 1. O que já existe

| Área | Estado |
|---|---|
| Cinema | Sync do ingresso (3 cinemas de Campinas), matching com TMDB, canaries, fila Revisar, home com trilhas, detalhe com sessões e link do ingresso.com. |
| Programação por data | `/programacao/AAAA-MM-DD`: todos os filmes de um dia, horários por cinema, filtros de cinema e de tipo de sala. Feita depois do `contexto.md`; faz parte da aba **Cinema** e fica. |
| Login | **Portão de Gatur já em produção** (`gatur-portao-client` v0.1.0, sessões em `portao_sessoes`). O papel vira perfil por um mapa fixo: `CAT → catflix`, `BEAR → hburso`. Sem `PORTAO_ISSUER`, volta o login por senha. |
| Marcações | `UserTitleState` com `quero_ver`, `marcado` e `visto`, com as três datas como histórico. Usado no detalhe (botões), na home (trilha "Já marcados por vocês"), no círculo com a inicial no pôster e no botão "Marcar com o Urso/a Gata" do hero. |
| Tags manuais | Por dono (`Tag.ownerId`): cada pessoa tem o próprio vocabulário; no detalhe, a tag da outra pessoa aparece tracejada e só o dono remove. |
| Créditos e estúdios | `Person.profileUrl` (foto), `TitleCredit.character` e `TitleCredit.order` **já existem e já são preenchidos**: 1.063 de 1.186 pessoas com foto; todo o elenco com personagem e ordem; 110 de 112 filmes casados com estúdio. Nada a acrescentar. |
| Deploy | Catploy, projeto `cineon`, `cineon.gatourso.com`. O backend roda `build:producao` = `prisma generate && prisma migrate deploy && tsc`: **toda migration nova vai para o banco de produção no deploy seguinte.** |

## 2. O que diverge do que a expansão supõe

1. **Usuário do Portão.** O §10.1 diz que o `sub` do Portão vira o id do `User`. Hoje os ids continuam `catflix` e `hburso`, e o papel do Portão escolhe qual. **Proposta: manter.** Trocar a chave primária de `User` é destrutivo (todas as marcações, tags e inscrições de push apontam para ela) e não ganha nada: são duas pessoas para sempre. Acrescento só `User.papel` (`CAT`/`BEAR`), para as tabelas novas e o feed falarem a língua do ecossistema.
2. **Data de estreia.** Há uma data só, `Title.releaseDate`, que guarda a estreia **do Brasil quando o TMDB a conhece, e a original quando não**. A cadência das notas do OMDb e a faixa "Estreia" dos cards dependem desse significado. *(Corrigido em 18/11/2026: a primeira versão deste arquivo dizia que era sempre a original.)*
3. **Sinopse.** Só em pt-BR, sem fallback. **20 dos 112 filmes casados estão sem sinopse.**
4. **Atualização de metadados.** Regra única de 30 dias, pensada para o cinema.
5. **Detalhe do filme.** Existe (`FilmePage`), mas na ordem "o que é, onde passa, quem fez". O print do CG pede outra ordem e blocos que não existem: elenco com foto, interesse, notas do casal, visualizações, Onde assistir, Remover do catálogo.
6. **`marcado` sai** (decisão de 18/11/2026). Hoje ele sustenta três coisas na home, e cada uma precisa de destino (ver §6, perguntas).
7. **Fila Revisar.** Não tem o motivo `import_low_confidence`. Ele só é necessário no passo 8 (importação) e entra lá, como acréscimo ao enum.

## 3. Resultado das verificações [VERIFICAR]

| Ponto | Resultado | Como foi verificado |
|---|---|---|
| Append de provedores | `append_to_response=watch/providers`; a resposta vem na chave `"watch/providers"`, com `results.BR.{flatrate,rent,buy,free,ads}`. O `link` aponta para o **TMDB**, não para o JustWatch, como o documento previa. | Chamada real à API (Duna: Parte Dois, Zootopia 2) |
| Códigos de estreia | 1 Premiere, 2 Theatrical (limited), 3 Theatrical, 4 Digital, 5 Physical, 6 TV. | Documentação oficial do TMDB |
| Status de produção | A documentação **não lista** os valores; dá só o exemplo `"Released"`. | Documentação oficial do TMDB |
| Busca do JustWatch BR | `https://br.justwatch.com/br/busca?q=<título>` funciona (o endereço `www.justwatch.com/br/busca` redireciona para ele). Páginas de filme são `/br/filme/<slug>`. | Acesso ao site |
| Atribuição JustWatch | Obrigatória: "you must attribute the source of the data as JustWatch". | Documentação oficial do TMDB |

Duas consequências para a implementação:

- **Estreia BR: usar a data de tipo 3 mais antiga, e não qualquer uma.** Duna: Parte Dois tem, no Brasil, tipo 3 em 29/02/2024 **e** tipo 2 em 03/12/2026 (reexibição). Pegar "a primeira que aparecer" ou "a do tipo 2" daria a data da reexibição.
- **Status de produção como texto, não enum.** Sem lista documentada, um valor novo do TMDB não pode quebrar o sync. É a mesma decisão que já vale para `Session.roomType`.
- A busca do JustWatch vai **só pelo título**, sem o ano: a busca do site é textual, e o ano no texto atrapalha mais do que ajuda.

## 4. Proposta de mudanças no `schema.prisma`

Tudo é acréscimo. Nenhuma coluna é apagada nem renomeada. Os nomes seguem o padrão do código (modelos e campos em inglês, tabelas em `snake_case`).

```prisma
// ── enums novos ──────────────────────────────────────────────
enum Pessoa {
  CAT
  BEAR
}

enum DatePrecision {
  DIA
  MES
  ANO
}

enum WatchLocation {
  CASA
  CINEMA
}

// ── User: acréscimo ─────────────────────────────────────────
model User {
  // ...campos atuais...
  /// papel no Portão. A migration preenche: catflix → CAT, hburso → BEAR
  papel Pessoa? @unique
}

// ── Title: acréscimos ───────────────────────────────────────
model Title {
  // ...campos atuais...
  // `releaseDate` mantém o significado atual (BR quando há, senão original);
  // as duas datas separadas entram ao lado
  releaseDateBr       DateTime? @map("release_date_br") @db.Date
  releaseDateOriginal DateTime? @map("release_date_original") @db.Date
  /// idioma de `overview`: "pt-BR" ou "en-US" (fallback do §5.2)
  overviewLanguage String?   @map("overview_language")
  /// Rumored, Planned, In Production, Post Production, Released, Canceled…
  /// texto, não enum: o TMDB não documenta a lista
  productionStatus String?   @map("production_status")
  justwatchUrl     String?   @map("justwatch_url")

  watches   Watch[]
  watchlist WatchlistEntry[]
  ratings   Rating[]
}

// ── Visualização: "já assistimos" ───────────────────────────
model Watch {
  id      String @id @default(cuid())
  titleId String @map("title_id")
  title   Title  @relation(fields: [titleId], references: [id], onDelete: Cascade)

  /// com precisão MES, guarda o dia 1; com ANO, 1º de janeiro
  watchedOn     DateTime      @map("watched_on") @db.Date
  datePrecision DatePrecision @default(DIA) @map("date_precision")
  location      WatchLocation
  /// nunca vazio (CHECK no SQL)
  participants  Pessoa[]

  // só quando location = CINEMA (CHECK no SQL)
  cinemaId       String?  @map("cinema_id")
  cinema         Cinema?  @relation(fields: [cinemaId], references: [id], onDelete: SetNull)
  cinemaFreeName String?  @map("cinema_free_name")
  roomType       String?  @map("room_type")

  note      String?
  removedAt DateTime? @map("removed_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@index([titleId])
  @@index([watchedOn])
  @@index([updatedAt]) // feed do CG
  @@map("watches")
}

// ── "Quero assistir": uma linha por pessoa e filme ─────────
model WatchlistEntry {
  id      String @id @default(cuid())
  titleId String @map("title_id")
  title   Title  @relation(fields: [titleId], references: [id], onDelete: Cascade)
  pessoa  Pessoa

  /// 1–5, as estrelas de "Marque seu interesse" (CHECK no SQL)
  interest  Int?
  addedAt   DateTime  @default(now()) @map("added_at") @db.Timestamptz(3)
  removedAt DateTime? @map("removed_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  /// tirar e pôr de novo reativa a mesma linha (removedAt = null)
  @@unique([titleId, pessoa])
  @@index([pessoa, removedAt])
  @@map("watchlist_entries")
}

// ── Nota de 0 a 10, meio ponto, uma por pessoa e filme ─────
model Rating {
  id      String  @id @default(cuid())
  titleId String  @map("title_id")
  title   Title   @relation(fields: [titleId], references: [id], onDelete: Cascade)
  pessoa  Pessoa
  /// 0–10 em passos de 0,5 (CHECK no SQL)
  score   Decimal @db.Decimal(3, 1)

  removedAt DateTime? @map("removed_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([titleId, pessoa])
  @@index([updatedAt]) // nota mudou → reenvia as visualizações no feed
  @@map("ratings")
}
```

`Cinema` ganha a relação inversa `watches Watch[]`.

**Regras que o Prisma não declara**, escritas à mão na migration e registradas
no `MIGRATIONS.md`, como os índices parciais que já existem:

```sql
ALTER TABLE watches ADD CONSTRAINT watches_participants_not_empty
  CHECK (cardinality(participants) >= 1);
ALTER TABLE watches ADD CONSTRAINT watches_cinema_only_at_cinema
  CHECK (location = 'CINEMA'
         OR (cinema_id IS NULL AND cinema_free_name IS NULL AND room_type IS NULL));
ALTER TABLE watchlist_entries ADD CONSTRAINT watchlist_interest_1_to_5
  CHECK (interest IS NULL OR interest BETWEEN 1 AND 5);
ALTER TABLE ratings ADD CONSTRAINT ratings_score_half_steps
  CHECK (score BETWEEN 0 AND 10 AND score * 2 = trunc(score * 2));
```

A regra "só dá nota quem participou de alguma visualização" fica no service,
não no banco: ela depende de outra tabela e de `removedAt`.

**Fica para depois, de propósito:**

- **Provedores de streaming** (`Provider` e `TitleProvider`, §3.1). São opcionais e só aparecem no passo 7. Proponho criá-los naquele passo, quando o desenho da tela disser o que guardar.
- **`import_low_confidence`** na fila Revisar entra no passo 8, se houver importação.

## 5. Migração dos dados do `UserTitleState`

**Não sabemos se a produção tem marcações.** O banco de desenvolvimento não tem nenhuma, e não tenho acesso de leitura ao banco do Catploy. Para conferir, basta abrir no navegador, logada no Cineon:

- `https://cineon.gatourso.com/api/titles?status=quero_ver`
- `https://cineon.gatourso.com/api/titles?status=visto`
- `https://cineon.gatourso.com/api/titles?status=marcado`

O `total` no fim de cada resposta é o número de filmes com aquele estado, somando as duas pessoas.

O plano funciona com ou sem dados:

| Estado | O que acontece | Por quê |
|---|---|---|
| `quero_ver` | Vira `WatchlistEntry` **na própria migration**, com `addedAt = wantedAt` e a pessoa pelo `papel` do usuário. Idempotente (`ON CONFLICT DO NOTHING`). | Conversão sem perda e sem decisão: é exatamente o mesmo significado. |
| `visto` | **Não é convertido automaticamente.** Um script (`backend/scripts/legado-visto.ts`) lista o que existir para você dizer data aproximada e local. | `Watch` exige local e quem estava; inventar seria pior que perguntar (§3.4). |
| `marcado` | Some das telas. | Decisão de 18/11/2026. |

A tabela `user_title_states` **não é apagada** nesta fase. Depois que a migração for conferida, proponho removê-la numa migration separada.

## 6. O que preciso de você para seguir

**Aprovação:**

1. O schema da seção 4, inclusive manter os ids `catflix`/`hburso` e acrescentar `User.papel` (divergência 1).
2. As decisões marcadas [ASSUMIDO] no documento, que vou seguir se você não disser nada:
   - as estrelas do print viram o `interest` de 1 a 5;
   - registrar uma visualização tira o filme da lista de quem estava, com "desfazer";
   - "Onde assistir" abre o `justwatchUrl` salvo ou, sem ele, a busca do JustWatch;
   - a navegação proposta: Cinema, Assistidos, Quero assistir, Mais.

**Perguntas novas, que surgem de "o marcado sai":**

3. O botão secundário do hero ("Marcar com o Urso / com a Gata") vira **"Quero assistir"**?
4. O círculo com a inicial no canto do pôster passa a mostrar **quem quer assistir** (a lista de cada um)? É o mesmo sinal do selo "Na sua lista" do §4.3.
5. A trilha "Já marcados por vocês" da home sai, e no lugar dela fica a aba "Quero assistir"?

**Em andamento do seu lado:** o dump e o schema do CG atual (§11), para eu planejar a importação do histórico.

---

## 7. Andamento

**18/11/2026: schema aprovado ("Comece").** As perguntas 3 a 5 da seção 6 continuam abertas; elas só afetam o frontend (passo 6).

| Passo | Estado |
|---|---|
| 2. Migrations | ✅ `20261118120000_acervo_do_casal` aplicada no banco de desenvolvimento. Os quatro CHECKs recusam o que devem e a conversão de `quero_ver` é idempotente (testado com dados). Regras registradas no `backend/prisma/MIGRATIONS.md`. Vai para produção no próximo deploy. |
| 3. Módulo `tmdb` | ✅ `TmdbClient.obterMetadata` (sinopse no idioma de reserva), estreia BR pela regra do §5.1, status de produção, `TMDB_LANGUAGE`/`TMDB_FALLBACK_LANGUAGE`/`TMDB_REGION`. Testes com respostas reais salvas em `__fixtures__`. |
| 4. `watches`, `watchlist`, `ratings`, `library` | ✅ Rotas do §9 (menos `where-to-watch`, que é do passo 7). 11 testes de integração e o fluxo inteiro percorrido pelo HTTP com o TMDB real. |
| 5. Job de metadata e notas do acervo | ✅ Metadata: lançamento (sem estreia ou com até 90 dias) a cada 7 dias, o resto a cada 90, no máximo 300 por execução, os mais velhos antes. Notas: mensal para filme com mais de 1 ano; cota diária (`OMDB_DAILY_QUOTA`, padrão 900) contada pelas chamadas das últimas 24 h. |
| 6.1 Fluxo do "+" | ✅ Página `/adicionar`, aberta pelo "+" do cabeçalho da home: busca com debounce (400 ms, a partir de 2 letras), Já assistimos (formulário reutilizável `FormularioDeVisualizacao`), Quero assistir, Eu e o outro queremos, Só abrir o filme. Testado no navegador com o TMDB real. |
| 6.2 Detalhe novo | ✅ `/filme/:id` agora é o detalhe do acervo (`DetalhePage`), na ordem do print, numa coluna (720 px no desktop). O detalhe antigo (`FilmePage`) e o hook do "marcado" saíram; o bloco de sessões virou `SessoesDoFilme`. Testado no navegador, celular e desktop. |
| Home sem o "marcado" | ✅ Selo do pôster = quem quer assistir, com o rosto do gato/urso; trilha "Na lista de vocês"; botão "Quero assistir" no destaque. |
| 6.3–6.4 Abas e navegação do §8 | ✅ Barra de baixo com Cinema / Assistidos / Quero assistir / Mais. Assistidos (`GET /assistidos`): um card por filme, filtros de quem, local, ano, gênero, diretor, nota e título, paginado. Quero assistir: as quatro trilhas e o filtro minha / dele / dos dois. Mais: perfil, Revisar (com badge), programação por data e "Sobre". Testado no navegador. |
| 6.5 Selo "Na sua lista" | ✅ Coberto pelos rostos no pôster (quem quer assistir) e pela trilha "Na lista de vocês" na home. |
| 7. Onde assistir e "Sobre" | ✅ Provedores de streaming do Brasil no detalhe, por tipo, com "Dados de streaming: JustWatch"; `GET /titles/:id/where-to-watch`; logo oficial do TMDB e as atribuições no "Sobre". Migration `provedores_de_streaming`. |
| §3.5 Filme fora do TMDB | próximo: migration que deixa a fila Revisar aceitar pendência sem evento do ingresso |

Medido depois do refresh de metadata no banco de desenvolvimento: dos 112 filmes casados, 100 com sinopse em pt-BR, 11 em en-US e 1 sem sinopse em idioma nenhum (antes: 20 sem sinopse). Status de produção vistos: Released 86, Post Production 21, In Production 3, Planned 2.

**Decisões tomadas na implementação:**

- O **matching do cinema não busca a sinopse de reserva**: ele pontua vários candidatos por evento e não precisa dela. Para isso não apagar a sinopse em inglês que o refresh trouxe, o `upsertPorTmdbId` só escreve a sinopse quando ela vem preenchida.
- A busca do "+" (§4.1) quer o **diretor em cada resultado**, mas a busca do TMDB não traz créditos: seriam um pedido a mais por resultado, a cada busca. Decido isso no passo 4, junto com a rota `GET /tmdb/search`.

**Decisões do passo 4:**

- **Diretor na busca do "+":** do banco, para filme que já está no catálogo; de um cache de processo (7 dias), para busca repetida; do TMDB (`/movie/{id}/credits`, bem mais leve que o detalhe) só para os 6 primeiros resultados que faltarem. Se o pedido falhar, o resultado sai sem diretor, e a busca não cai.
- **"Nós dois" na lista** (`paraOsDois`) põe o filme na lista da outra pessoa **sem interesse**: as estrelas são de cada um.
- **Tags do "Editar"** usam as rotas que já existem (`POST`/`DELETE /titles/:id/tags`), com a regra de que cada pessoa só remove as suas. O `PATCH /library/titles/:id` cuida só do link do JustWatch, e só aceita endereço `https://…justwatch.com`.
- **Remover do catálogo** usa um carimbo único; o desfazer (`POST /library/titles/:id/restaurar`) volta só o que aquele carimbo tirou, e uma visualização apagada antes continua apagada.
- **Refresh depois do deploy:** o job de metadata trata como vencida toda metadata gravada antes destas colunas existirem. Sem isso, em produção um filme passaria até 30 dias aparecendo como "Estreia (mundial)".
- **Ainda falta (§3.5): criar filme que não está no TMDB.** A fila Revisar exige um evento do ingresso em cada pendência (`review_items.ingresso_event_id` é obrigatório), então isso pede outra migration, que torna a coluna opcional (não é destrutiva). Fica para um passo próprio.
- **Visualização apagada depois da nota:** a nota fica. Apagar a visualização por engano não deve levar a nota junto, e o "Remover do catálogo" já tira tudo de uma vez quando é essa a intenção.

**Decisões do passo 5:**

- **A cota do OMDb é uma janela móvel de 24 h**, contada pelos payloads brutos do OMDb (toda chamada é gravada, inclusive as que falham, que também gastam cota). Não sabemos a que horas o OMDb zera o contador, e a janela móvel nunca passa do limite, seja qual for o relógio dele.
- **Quando a cota não dá para todos:** primeiro o que está em cartaz ou em pré-estreia, depois o que nunca foi consultado, depois a consulta mais antiga. Assim um acervo recém-importado não deixa o filme que estreou ontem sem nota.
- **Filme sem data:** se o status for "Released", é acervo (90 dias); se for anunciado ou em produção, é lançamento (7 dias).
- **Medido no banco de desenvolvimento em 18/11/2026:** metadata 0 vencidos de 112 (refrescados no mesmo dia); notas 109 consultadas dentro da cota, 108 com resposta e 1 que o OMDb não conhece. Rodando de novo, o job viu as 109 chamadas na cota e não tinha nada vencido.

**Decisões do passo 6.1:**

- **O "+" é uma página, não uma janela por cima:** assim o voltar do Android desfaz um passo (resultado → busca) em vez de fechar o app.
- **Busca enquanto digita, com 400 ms de espera e a partir de 2 letras.** A tela de "trocar filme" da Revisão busca só ao apertar o botão; aqui o documento pede debounce, e o backend já guarda o diretor em cache.
- **"Assistimos" começa com as duas pessoas marcadas:** quem viu sozinho desmarca a outra.
- **Data com precisão:** Dia / Mês / Só o ano, que viram os formatos que o backend entende.
- **"Só abrir o filme" ainda abre o detalhe antigo** (`/filme/:id`), até o detalhe novo existir.
- **O "+" está só na home por enquanto.** As outras telas ganham o botão quando a navegação nova do §8 entrar (6.3–6.4).
- **O link "Não encontrei o filme" (§3.5) não aparece** enquanto a fila Revisar não aceitar pendência sem evento do ingresso.

**Respostas de 18/11/2026 (perguntas 3 a 5 e o layout do detalhe):**

- **Detalhe no desktop:** a mesma coluna do celular, mais larga. O elenco quebra em linhas em vez de rolar de lado.
- **Botão do destaque:** "Quero assistir", que grava direto da home; tocar de novo tira da lista, e o rótulo vira "Na sua lista ✓".
- **Selo do pôster:** em vez da inicial, o **rosto do gato ou do urso** (Icons.png da Carol, redesenhado em SVG para pegar a cor do perfil). O urso sai no roxo do HBUrso, não no azul do PNG: o §7 proíbe uma terceira cor. *Assumido:* o selo mostra **quem quer assistir**, a recomendação da pergunta, que a resposta não contradisse.
- **Trilha da home:** "Já marcados por vocês" virou **"Na lista de vocês"**: filmes da lista que estão em cartaz ou em pré-estreia, primeiro os que os dois querem.

**Decisões do passo 6.2:**

- **O "Onde assistir" já funciona**, pelo campo `ondeAssistirUrl` do detalhe: o link salvo do JustWatch ou a busca dele pelo título (`JUSTWATCH_SEARCH_URL`). A rota própria `GET /titles/:id/where-to-watch` e os provedores de streaming continuam no passo 7.
- **Estrelas antes de assistir, notas depois.** Marcar estrelas põe o filme na lista; tocar na estrela que já está marcada apaga as estrelas, mas mantém na lista; "tirar" tira da lista. A nota é um seletor de 0 a 10 em meio ponto, só para quem assistiu.
- **Remover do catálogo** pede confirmação e oferece "Desfazer" até a página recarregar; ao remover, some o "Desfazer" da lista, que não faria mais sentido.
- **"Editar"** abre o link do JustWatch e as tags manuais ("De bisnaguinha", "De crédito"), que aparecem como chips no topo.

**Decisões do passo 6.3–6.4:**

- **Revisar saiu do cabeçalho da home e foi para "Mais"** (§8). A pendência aparece como badge na aba "Mais" da barra; sem pendência, nem o item nem a badge aparecem (§2).
- **A barra continua em pílula no desktop**, sem sidebar: o "o desktop segue o mobile" de 23/09/2026 vale também aqui.
- **Assistidos é um card por filme**, não por visualização: rever não duplica o pôster. A faixa é a data da última vez (dia, "jul 2019" ou só o ano), os rostos são quem viu, e a linha diz onde e quantas vezes.
- **Filtro de nota = "algum de vocês deu nota ≥ X".** O §8 não diz de quem; esta é a leitura que não esconde filme bem avaliado por um dos dois.
- **Ano, gênero, nota e diretor ficam em "Mais filtros"**, para não empurrar a grade para baixo. Os anos e os gêneros oferecidos são só os que existem nos assistidos.
- **A home se chama "Cinema"**, o nome da aba.

**Decisões do passo 7:**

- **Os provedores vêm no mesmo pedido de detalhe** (`append_to_response=…,watch/providers`), sem chamada a mais. São reescritos a cada refresh de metadata e guardados em `streaming_providers` e `title_providers`, as tabelas opcionais do §3.1.
- **"Não sei" é diferente de "em nenhum serviço".** Sem o bloco na resposta, os provedores ficam como estavam; com o bloco vazio, a lista é esvaziada. `providers_updated_at` nulo faz o job ler os provedores de todo filme uma vez depois do deploy.
- **Ordem na tela:** assinatura, grátis, com anúncios, aluguel, compra — primeiro o que já se paga.
- **O logo do TMDB** é o arquivo oficial da página de atribuição (versão curta, SVG), em `frontend/public/tmdb-logo.svg`.
- **Medido no banco de desenvolvimento em 18/11/2026:** 112 filmes lidos, 30 disponíveis em algum serviço no Brasil (os outros estão em cartaz ou não lançaram). Os mais comuns: Amazon Video, Apple TV, Claro tv+, Netflix, Disney+.

---

## 8. Importação do histórico do CG antigo (§11) — mapeamento proposto

Lido em 19/11/2026 do código do Crônicas de Gatur (`Documents/Outros/CronicasGatur`, `backend/prisma/schema.prisma` e o frontend). **Ainda não implementado**: espera o dump atual e as respostas da seção 8.4.

### 8.1 De onde vêm os filmes

| Tabela do CG | O que é | Vira no Cineon |
|---|---|---|
| `activities` com `type = 'filme'` | a timeline: "assistimos a tal filme em tal dia" | `Watch` (uma por linha) |
| `collections` com `collection_type` de filme | o catálogo: lista "quero assistir", "assistindo", "concluído" | `WatchlistEntry` e tags manuais |

Séries e animes (`type = 'serie'`/`'anime'`) ficam de fora, como manda o §1.

### 8.2 Campo a campo (`activities` → `Watch`)

| CG | Cineon | Observação |
|---|---|---|
| `title` (+ `collection.tmdb_id`, quando houver) | `Title` pelo `tmdb_id` | `activities` não tem `tmdb_id`. Busca no TMDB por título e ano; o que não for confiança alta vai para a fila Revisar |
| `activity_date` (sempre data completa) | `watchedOn`, precisão `DIA` | o CG não tem data incompleta |
| `who_did`: `cat` / `bear` / `both` | `participants`: `[CAT]` / `[BEAR]` / `[CAT, BEAR]` | `both` é o padrão do CG |
| `location`: `casa` / `cinema` / nulo | `CASA` / `CINEMA` | nulo vira `CASA`, que é o que o formulário do CG mostra |
| `rating_cat`, `rating_bear` (inteiros 1–10, exibidos como 0,5–5 estrelas) | `Rating` de cada pessoa, mesmo número | cabe direto na escala 0–10 do Cineon |
| `notes_cat`, `notes_bear` | `Watch.note` | as duas juntas, cada uma com o nome de quem escreveu |
| `favorite_cat`, `favorite_bear` | — | sem equivalente (pergunta 3) |

### 8.3 Catálogo (`collections` → lista e tags)

| CG | Cineon |
|---|---|
| `status_cat` / `status_bear` = `quero_assistir` | `WatchlistEntry` da pessoa |
| `interest_cat`, `interest_bear` | `interest` da pessoa (falta confirmar a escala) |
| `payment_bisnaguinha` / `payment_credito` | tags manuais "De bisnaguinha" (da Carol) e "De crédito" (dele) |
| `tmdb_id` (quando veio de "Lançamentos") | liga direto ao `Title`, sem busca |

### 8.4 O que precisa de resposta

1. **Dump atual.** O `dump.sql` da pasta do CG é de 29/06/2026 e a tabela `activities` está **vazia** nele. Precisa de um dump novo do banco `cg` (ver os comandos no fim da conversa de 19/11/2026: `pg_dump -h localhost -U cat -d cg -Fc -f cg-antigo.dump`).
2. **Filme "concluído" no catálogo sem atividade na timeline:** vira `Watch` sem data (ano do `added_date`, precisão `ANO`) ou fica de fora?
3. **Favoritos** (`favorite_cat`/`favorite_bear`): viram uma tag manual "Favorito" de cada pessoa, ou ficam de fora?
4. **"De bisnaguinha" e "De crédito":** no CG o código marca automaticamente **quem adicionou** (bisnaguinha = o gato adicionou, crédito = o urso). Em 18/11/2026 a Carol descreveu como **quem gosta mais**. Para importar, vale o valor que está no CG?

### 8.5 Depende de outra peça

A fila Revisar precisa aceitar pendência **sem evento do ingresso** (hoje `review_items.ingresso_event_id` é obrigatório) e o motivo `import_low_confidence`. É a mesma migration do §3.5 (filme fora do TMDB), então as duas entram juntas.

⚠️ **Privacidade:** o `dump.sql` antigo está **versionado no git do repositório do CG**. Ele tem só as tabelas quase vazias de junho, mas inclui `users` (com hash de senha) e `push_subscriptions`. Vale tirá-lo do repositório e não versionar o dump novo.

### 8.6 O que tem no dump (`dumpCG.sql`, recebido em 19/11/2026)

Dump em SQL texto do PostgreSQL 18.6, na raiz do projeto e **fora do git** (`.gitignore` criado na raiz no mesmo dia). Perfil só numérico, sem ler títulos nem comentários:

| | Número |
|---|---|
| Visualizações de filme na timeline (`activities`, `type = 'filme'`) | **94**, de 02/07/2010 a 12/11/2026; nenhum filme visto duas vezes |
| Quem viu | os dois: 79 · só a Carol: 12 · só ele: 3 |
| Onde | cinema: 56 · casa: 20 · sem informação: 18 (vira casa) |
| Ligadas a um item do catálogo | 93 de 94 (1 aponta para um item que não existe mais) |
| Filmes no catálogo (`collections`, `collection_type = 'filme'`) | **181** |
| …com `tmdb_id` | **só 17**; nenhum dos 17 é das 94 visualizações |
| "Quero assistir" | Carol: 56 · ele: 53 |
| "Concluído" | 99 (6 sem visualização na timeline) |
| Com nota | 64 filmes (5 deles sem visualização na timeline); notas de 2 a 10 |
| Com comentário | Carol: 44 · ele: 38 |
| Interesse (escala 1–5, a mesma do Cineon) | Carol: 12 · ele: 14 |
| Favoritos | Carol: 6 · ele: 4 |
| "De bisnaguinha" / "De crédito" | 29 / 38 |

**Correções ao que a seção 8.2 supunha:** no CG as **notas e os comentários ficam no catálogo** (`collections`), não na timeline (os campos da timeline estão todos vazios). Por isso a nota e o comentário de um filme vão para a visualização ligada a ele.

**Consequência para o casamento com o TMDB:** como quase nada tem `tmdb_id`, o script busca cada filme no TMDB pelo título e confere com o que o catálogo do CG guarda — ano (`release_date`), diretor e duração. O que bater nos três entra direto; o resto vai para a fila Revisar com o motivo `import_low_confidence`.

### 8.7 Decisões da Carol (19/11/2026)

- **Favoritos** (`favorite_cat`/`favorite_bear`): viram uma **tag manual "Favorito" de cada pessoa** (6 da Carol, 4 dele).
- **"De bisnaguinha" e "De crédito" não são importados.** As tags continuam existindo no Cineon, mas começam vazias.
- **Os seis filmes "concluídos" no catálogo sem visualização na timeline:**

  | Filme | Decisão |
  |---|---|
  | Bugonia | assistido **no cinema**, na data de lançamento que o CG guarda (27/11/2025), pelos dois; notas: Carol 10, ele 9 |
  | Como Treinar o Seu Dragão 3 | assistido **no cinema** em 17/01/2019, só a Carol; nota dela 10 |
  | Como Treinar o Seu Dragão (live-action) | assistido **no cinema** em 07/06/2025, só a Carol; nota dela 10 |
  | Gato de Botas 2: O Último Pedido | assistido **no cinema** em 07/12/2022, pelos dois; sem nota |
  | A Mulher de Preto | **não assistido**: sem visualização, e a nota 7 dela não é importada (só dá nota quem assistiu) |
  | A Origem dos Guardiões | **não assistido**: sem visualização, e a nota 8 dela não é importada |

  "Quem" vem do `who_did` do CG. A data é a de lançamento exatamente como o CG a guarda (data completa, precisão de dia).

### 8.8 Andamento da importação (19/11/2026)

**Pronto e testado; simulado com o dump real; ainda NÃO aplicado em banco nenhum.**

- Migration `20261119120000_revisao_sem_ingresso`: a fila Revisar aceita pendência sem evento do ingresso (`origin`, `import_low_confidence`); `ExternalSource.cronicas_gatur` torna a importação idempotente.
- `mergeTitles` agora leva visualizações, lista, notas e provedores. Era uma lacuna real: uma resolução da fila deixaria esses dados presos no título absorvido.
- Módulo `importacao` e o comando `npm run importar:cg -- --dump ../dumpCG.sql [--aplicar]`. Sem `--aplicar` é simulação. O relatório sai em `backend/relatorios/`, fora do git.

**Simulação com o dump real:** 181 filmes com algo a importar; **177 casaram com certeza** (17 pelo `tmdb_id` do CG, 156 por título + ano + diretor, 3 por título + ano sem diretor); **4 vão para a fila Revisar**: O Frio da Morte (o TMDB não achou o título), Scarlet (dois filmes com o mesmo título, ano e diretor), Como Treinar o Seu Dragão de 2025 (o CG guarda o diretor errado) e Barbie: Escola de Princesas (sem ano nem diretor). Entram 98 visualizações, 166 entradas de lista, 98 notas e 10 tags "Favorito".

**Itens repetidos no catálogo do CG:** 8 filmes aparecem duas vezes. Entram no mesmo filme do Cineon, e quem assistiu por um item não fica na lista pelo outro (testado). *Homem-Aranha: Sem Volta Para Casa* tem duas visualizações, uma em cada item: pode ser rever ou registro repetido.

**Aplicada no banco de DESENVOLVIMENTO em 19/11/2026** (produção ainda não):

- Decisão da Carol: *Homem-Aranha: Sem Volta Para Casa* era **registro repetido** no CG. Fica a visualização de 17/11/2021 no cinema; a de 26/07/2026 em casa (data do cadastro do acervo no CG) não entra, e a nota 8 dela passa para o filme (`VISUALIZACOES_REPETIDAS` na leitura).
- Resultado: 181 filmes importados; 97 visualizações; 152 entradas ativas na lista; 98 notas; 10 tags "Favorito"; 4 pendências na fila. Nenhuma pessoa ficou "assistiu e quer assistir" no mesmo filme. A segunda execução reconheceu os 181 como já importados e não gravou nada.
- Confirmada na fila, de ponta a ponta, a pendência de *Como Treinar o Seu Dragão* (2025): o órfão foi unido ao filme do TMDB levando a visualização e a nota.
- Corrigido no caminho: o filtro da fila validava o motivo contra uma lista escrita à mão, sem `import_low_confidence` (dava 400); agora vem do enum do banco. A fila mostra a origem de cada pendência ("No Crônicas de Gatur").

**Para produção:** depois do deploy (que aplica as migrations), rodar `npm run importar:cg -- --dump <dump> --aplicar` contra o banco de produção — no servidor, ou da máquina da Carol por um túnel SSH.
- Corrigido também: com a importação, as duas pessoas passaram a ter a tag manual "Favorito", e o painel de tags mostrava **duas** linhas "Favorito" (uma por dono, cada uma contando só os filmes do dono) enquanto o filtro da lista juntava os dois. O painel agora agrupa a tag pelo nome — a contagem do painel volta a ser a da lista. Teste em `tags.facetas.integracao.test.ts`.
