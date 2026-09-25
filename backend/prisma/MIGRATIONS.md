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
