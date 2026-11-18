-- CreateEnum
CREATE TYPE "Pessoa" AS ENUM ('CAT', 'BEAR');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DIA', 'MES', 'ANO');

-- CreateEnum
CREATE TYPE "WatchLocation" AS ENUM ('CASA', 'CINEMA');

-- AlterTable
ALTER TABLE "titles" ADD COLUMN     "justwatch_url" TEXT,
ADD COLUMN     "overview_language" TEXT,
ADD COLUMN     "production_status" TEXT,
ADD COLUMN     "release_date_br" DATE,
ADD COLUMN     "release_date_original" DATE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "papel" "Pessoa";

-- CreateTable
CREATE TABLE "watches" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "watched_on" DATE NOT NULL,
    "date_precision" "DatePrecision" NOT NULL DEFAULT 'DIA',
    "location" "WatchLocation" NOT NULL,
    "participants" "Pessoa"[],
    "cinema_id" TEXT,
    "cinema_free_name" TEXT,
    "room_type" TEXT,
    "note" TEXT,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_entries" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "pessoa" "Pessoa" NOT NULL,
    "interest" INTEGER,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "watchlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "pessoa" "Pessoa" NOT NULL,
    "score" DECIMAL(3,1) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watches_title_id_idx" ON "watches"("title_id");

-- CreateIndex
CREATE INDEX "watches_watched_on_idx" ON "watches"("watched_on");

-- CreateIndex
CREATE INDEX "watches_updated_at_idx" ON "watches"("updated_at");

-- CreateIndex
CREATE INDEX "watchlist_entries_pessoa_removed_at_idx" ON "watchlist_entries"("pessoa", "removed_at");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_entries_title_id_pessoa_key" ON "watchlist_entries"("title_id", "pessoa");

-- CreateIndex
CREATE INDEX "ratings_updated_at_idx" ON "ratings"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_title_id_pessoa_key" ON "ratings"("title_id", "pessoa");

-- CreateIndex
CREATE UNIQUE INDEX "users_papel_key" ON "users"("papel");

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_cinema_id_fkey" FOREIGN KEY ("cinema_id") REFERENCES "cinemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Regras que o Prisma não declara (ver MIGRATIONS.md, "Acervo do casal")
-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────
-- Dados (só o que não exige decisão — ESTADO_ATUAL.md §5)
-- ─────────────────────────────────────────────────────────────

-- o papel do Portão de cada perfil: o mesmo mapa de users.portao.ts
UPDATE "users" SET "papel" = 'CAT'  WHERE "id" = 'catflix' AND "papel" IS NULL;
UPDATE "users" SET "papel" = 'BEAR' WHERE "id" = 'hburso'  AND "papel" IS NULL;

-- "quero ver" vira "quero assistir": mesmo significado, nenhuma perda.
-- `visto` NÃO é convertido aqui (exige local e quem estava); `marcado` sai.
-- A tabela user_title_states fica intacta.
INSERT INTO "watchlist_entries" ("id", "title_id", "pessoa", "added_at", "updated_at")
SELECT 'legado-' || s."id",
       s."title_id",
       u."papel",
       COALESCE(s."wanted_at", s."status_changed_at"),
       CURRENT_TIMESTAMP
FROM "user_title_states" s
JOIN "users" u ON u."id" = s."user_id"
JOIN "titles" t ON t."id" = s."title_id"
WHERE s."status" = 'quero_ver'
  AND u."papel" IS NOT NULL
  AND t."status" <> 'merged'
ON CONFLICT ("title_id", "pessoa") DO NOTHING;
