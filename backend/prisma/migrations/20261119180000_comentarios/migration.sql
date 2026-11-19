-- Comentários de cada pessoa sobre o filme (pedido da Carol, 19/11/2026).
-- Só acrescenta: uma tabela nova e a cópia dos comentários do CG antigo.

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "pessoa" "Pessoa" NOT NULL,
    "text" TEXT NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
    -- comentário vazio não existe: apagar é marcar removed_at
    CONSTRAINT "comments_text_nao_vazio" CHECK (length(btrim("text")) > 0)
);

-- CreateIndex
CREATE INDEX "comments_updated_at_idx" ON "comments"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "comments_title_id_pessoa_key" ON "comments"("title_id", "pessoa");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Os comentários que a importação do CG pôs na observação ──────────────
--
-- A importação (§11) gravou os comentários do CG na observação da primeira
-- visualização, como "🐱 <da Carol>\n🐻 <dele>" (um dos dois pode faltar, e o
-- texto de cada um pode ter quebras de linha). Aqui eles viram comentários de
-- verdade, e a observação dessas visualizações fica vazia, para o texto não
-- aparecer duas vezes. Observação escrita à mão não começa com o rosto e não é
-- tocada.
--
-- Um filme repetido no CG pode ter o comentário em duas visualizações: os
-- textos diferentes são juntados com uma linha em branco.

CREATE TEMP TABLE "_comentarios_do_cg" AS
SELECT w."id" AS "watch_id",
       w."title_id",
       -- o rosto e o espaço são os 2 primeiros caracteres; o texto do urso
       -- começa depois de "\n🐻 " (3 caracteres)
       CASE WHEN w."note" LIKE '🐱 %' THEN
         btrim(CASE WHEN strpos(w."note", E'\n🐻 ') > 0
                    THEN substring(w."note" FROM 3 FOR strpos(w."note", E'\n🐻 ') - 3)
                    ELSE substring(w."note" FROM 3) END, E' \n\r\t')
       END AS "cat",
       CASE WHEN strpos(w."note", E'\n🐻 ') > 0
              THEN btrim(substring(w."note" FROM strpos(w."note", E'\n🐻 ') + 3), E' \n\r\t')
            WHEN w."note" LIKE '🐻 %' THEN btrim(substring(w."note" FROM 3), E' \n\r\t')
       END AS "bear"
FROM "watches" w
WHERE w."note" LIKE '🐱 %' OR w."note" LIKE '🐻 %';

INSERT INTO "comments" ("id", "title_id", "pessoa", "text", "created_at", "updated_at")
SELECT 'cg-' || md5(c."title_id" || ':' || c."pessoa"::text),
       c."title_id",
       c."pessoa",
       string_agg(DISTINCT c."texto", E'\n\n'),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM (
  SELECT "title_id", 'CAT'::"Pessoa" AS "pessoa", "cat" AS "texto" FROM "_comentarios_do_cg" WHERE "cat" <> ''
  UNION ALL
  SELECT "title_id", 'BEAR'::"Pessoa", "bear" FROM "_comentarios_do_cg" WHERE "bear" <> ''
) c
JOIN "titles" t ON t."id" = c."title_id"
WHERE t."status" <> 'merged'
GROUP BY c."title_id", c."pessoa"
ON CONFLICT ("title_id", "pessoa") DO NOTHING;

UPDATE "watches" w
SET "note" = NULL, "updated_at" = CURRENT_TIMESTAMP
FROM "_comentarios_do_cg" c
WHERE w."id" = c."watch_id";

DROP TABLE "_comentarios_do_cg";
