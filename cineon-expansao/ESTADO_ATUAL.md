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
| 5. Job de metadata e notas do acervo | próximo |

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
