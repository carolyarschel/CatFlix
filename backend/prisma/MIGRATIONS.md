# Migrations — o que o Prisma não declara sozinho

Regra do projeto (§6): **migrations somam ao schema; nada destrutivo em tabelas existentes.**

O Prisma não sabe declarar índice parcial (`CREATE INDEX ... WHERE`). Os quatro
índices abaixo são regras de integridade reais do modelo e precisam entrar como
SQL cru dentro do migration. Sem eles o schema *parece* correto e vaza duplicata
em produção.

## Como aplicar

Gere o migration sem executar, cole o SQL no fim do arquivo e aplique:

```powershell
npx prisma migrate dev --name init --create-only
# abra prisma/migrations/<timestamp>_init/migration.sql e cole o bloco abaixo no fim
npx prisma migrate dev
```

## SQL a acrescentar

```sql
-- 1. Um Title não pode acumular dois tmdb_id.
--    (O @@unique([source, externalId]) já garante o outro lado: um tmdb_id
--     nunca aparece em dois Titles — critério de aceite nº 2.)
CREATE UNIQUE INDEX IF NOT EXISTS title_external_ids_one_tmdb_per_title
  ON title_external_ids (title_id)
  WHERE source = 'tmdb';

-- 2. Tags automáticas não podem duplicar.
--    No Postgres NULL é distinto de NULL em índice único, então o
--    @@unique([facet, value, ownerId]) NÃO impede duas tags auto iguais,
--    porque owner_id é NULL nelas. Sem este índice, o primeiro rebuild de
--    tags do sync duplica a faceta inteira.
CREATE UNIQUE INDEX IF NOT EXISTS tags_unique_auto
  ON tags (facet, value)
  WHERE owner_id IS NULL;

-- 3. Um alerta aberto por fingerprint (§8: "não reenviar o mesmo alerta
--    enquanto não resolvido").
CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_open_per_fingerprint
  ON alerts (fingerprint)
  WHERE resolved_at IS NULL;

-- 4. Um item de revisão aberto por evento do ingresso. Sem isto, três syncs
--    seguidos empilham três pendências do mesmo filme e o badge mente.
CREATE UNIQUE INDEX IF NOT EXISTS review_items_one_open_per_event
  ON review_items (ingresso_event_id)
  WHERE status = 'open';
```

## Extensão pg_trgm

Já está declarada no `datasource` via `extensions = [pg_trgm]` (preview
`postgresqlExtensions`), então o `migrate dev` emite o `CREATE EXTENSION`
sozinho. Se o usuário do banco não for superusuário, rode uma vez como
superusuário:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Os índices GIN `gin_trgm_ops` sobre `titles.normalized_title` e
`titles.normalized_original_title` **estão no schema** e são gerados pelo
Prisma — não precisam de SQL manual.

## Ao criar migrations futuros

- Coluna nova sempre nullable ou com `@default`, para não travar em tabela cheia.
- Renomear coluna = criar a nova, copiar, deixar a antiga para trás. Nunca `DROP`
  no mesmo migration que introduz a substituta.
- Valor novo em enum é aditivo e seguro; remover valor de enum não é.

## Acervo do casal (`20261118120000_acervo_do_casal`)

Expansão do `cineon-expansao/contexto-expansao.md`. Só soma: três enums, três
tabelas (`watches`, `watchlist_entries`, `ratings`), cinco colunas em `titles`
e `users.papel`. O SQL gerado pelo Prisma foi completado à mão com:

```sql
-- quem assistiu nunca é vazio. O Prisma cria a lista aceitando NULL, e
-- cardinality(NULL) passaria num CHECK — por isso o NOT NULL explícito
ALTER TABLE "watches" ADD CONSTRAINT "watches_participants_not_empty"
  CHECK ("participants" IS NOT NULL AND cardinality("participants") >= 1);

-- cinema e sala só existem quando foi no cinema
ALTER TABLE "watches" ADD CONSTRAINT "watches_cinema_only_at_cinema"
  CHECK ("location" = 'CINEMA'
         OR ("cinema_id" IS NULL AND "cinema_free_name" IS NULL AND "room_type" IS NULL));

ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_interest_1_to_5"
  CHECK ("interest" IS NULL OR "interest" BETWEEN 1 AND 5);

-- 0 a 10, em passos de meio ponto
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_score_half_steps"
  CHECK ("score" BETWEEN 0 AND 10 AND "score" * 2 = trunc("score" * 2));
```

E com a conversão de dados que não exige decisão: `users.papel` (`catflix →
CAT`, `hburso → BEAR`) e `quero_ver → watchlist_entries`, idempotente (`ON
CONFLICT DO NOTHING`, id `legado-<id antigo>`). `visto` **não** é convertido na
migration — exige local e quem estava — e `marcado` sai do app. A tabela
`user_title_states` fica intacta até a conversão ser conferida.

**Por que a conversão mora na migration:** o deploy do Catploy roda
`prisma migrate deploy` (`build:producao`), então a migration é o único ponto
que com certeza roda uma vez em produção, na ordem certa.

Verificado no banco de desenvolvimento em 18/11/2026: os quatro CHECKs recusam
o que devem e o INSERT rodado duas vezes produz uma linha só.

> ⚠️ `prisma migrate dev` exige terminal interativo. Fora dele, gere o SQL com
> `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma
> --to-schema-datamodel prisma/schema.prisma --script` dentro de uma pasta
> nova em `prisma/migrations/`, complete à mão e aplique com
> `npx prisma migrate deploy`.

## Provedores de streaming (`20261118200000_provedores_de_streaming`)

Passo 7 da expansão (§3.1 e §6): `streaming_providers`, `title_providers` e
`titles.providers_updated_at`. Só soma; o SQL gerado pelo Prisma não precisou
de nada à mão. Os provedores vêm no mesmo pedido de detalhe do TMDB
(`append_to_response=…,watch/providers`) e são reescritos a cada refresh de
metadata. `providers_updated_at` nulo quer dizer "nunca lido", e é isso que faz
o job de metadata ler os provedores de todo filme uma vez depois do deploy.
