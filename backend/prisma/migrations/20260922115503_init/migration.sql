-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('movie', 'series');

-- CreateEnum
CREATE TYPE "TitleStatus" AS ENUM ('matched', 'orphan', 'not_a_film');

-- CreateEnum
CREATE TYPE "ExternalSource" AS ENUM ('ingresso', 'tmdb', 'imdb', 'tvdb', 'radarr', 'sonarr', 'jellyfin');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('cache', 'exact', 'fuzzy', 'manual');

-- CreateEnum
CREATE TYPE "CreditRole" AS ENUM ('director', 'cast');

-- CreateEnum
CREATE TYPE "AudioType" AS ENUM ('original', 'dublado', 'legendado', 'desconhecido');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('regular', 'pre_estreia', 'especial');

-- CreateEnum
CREATE TYPE "AvailabilitySource" AS ENUM ('cinema', 'jellyfin', 'radarr', 'sonarr');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('em_cartaz', 'pre_estreia', 'em_breve', 'na_biblioteca', 'monitorado');

-- CreateEnum
CREATE TYPE "UserTitleStatus" AS ENUM ('quero_ver', 'marcado', 'visto');

-- CreateEnum
CREATE TYPE "TagFacet" AS ENUM ('sala', 'cinema', 'audio', 'manual');

-- CreateEnum
CREATE TYPE "TagOrigin" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "MatchStage" AS ENUM ('cache', 'triage', 'strong', 'fuzzy', 'threshold');

-- CreateEnum
CREATE TYPE "MatchOutcome" AS ENUM ('accepted', 'review', 'orphan', 'not_a_film', 'no_candidate');

-- CreateEnum
CREATE TYPE "ReviewReason" AS ENUM ('low_confidence', 'no_candidate', 'possible_duplicate', 'probable_non_film');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "ReviewResolution" AS ENUM ('confirmed', 'replaced', 'marked_not_a_film', 'merged', 'dismissed');

-- CreateEnum
CREATE TYPE "RawSource" AS ENUM ('ingresso', 'tmdb', 'omdb');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('ingresso_sessions', 'ingresso_now_playing', 'ingresso_upcoming', 'tmdb_metadata', 'omdb_ratings', 'tags_rebuild', 'manual');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('running', 'success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "CanaryLayer" AS ENUM ('transport', 'contract', 'semantic', 'matching');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "raw_payloads" (
    "id" TEXT NOT NULL,
    "source" "RawSource" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "params" JSONB,
    "body_hash" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "http_status" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_run_id" TEXT,

    CONSTRAINT "raw_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "job_type" "SyncJobType" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "triggered_by" TEXT,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "details" JSONB,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canary_checks" (
    "id" TEXT NOT NULL,
    "layer" "CanaryLayer" NOT NULL,
    "target" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "measured_value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "message" TEXT,
    "details" JSONB,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_run_id" TEXT,

    CONSTRAINT "canary_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "notifier" TEXT,
    "details" JSONB,
    "canary_check_id" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titles" (
    "id" TEXT NOT NULL,
    "media_type" "MediaType" NOT NULL DEFAULT 'movie',
    "status" "TitleStatus" NOT NULL DEFAULT 'orphan',
    "title" TEXT NOT NULL,
    "original_title" TEXT,
    "normalized_title" TEXT NOT NULL,
    "normalized_original_title" TEXT,
    "year" INTEGER,
    "release_date" DATE,
    "runtime_minutes" INTEGER,
    "overview" TEXT,
    "poster_url" TEXT,
    "backdrop_url" TEXT,
    "imdb_rating" DECIMAL(3,1),
    "rt_rating" INTEGER,
    "ratings_updated_at" TIMESTAMPTZ(3),
    "metadata_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_external_ids" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "source" "ExternalSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "method" "MatchMethod" NOT NULL,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "title_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_aliases" (
    "id" TEXT NOT NULL,
    "from_title_id" TEXT NOT NULL,
    "to_title_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "merged_by_id" TEXT,
    "merged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB,

    CONSTRAINT "title_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "tmdb_id" INTEGER,
    "name" TEXT NOT NULL,
    "profile_url" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_credits" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" "CreditRole" NOT NULL,
    "character" TEXT,
    "order" INTEGER,

    CONSTRAINT "title_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" TEXT NOT NULL,
    "tmdb_id" INTEGER,
    "name" TEXT NOT NULL,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_genres" (
    "title_id" TEXT NOT NULL,
    "genre_id" TEXT NOT NULL,

    CONSTRAINT "title_genres_pkey" PRIMARY KEY ("title_id","genre_id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tmdb_id" INTEGER,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "origin_country" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_companies" (
    "title_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "title_companies_pkey" PRIMARY KEY ("title_id","company_id")
);

-- CreateTable
CREATE TABLE "cinemas" (
    "id" TEXT NOT NULL,
    "ingresso_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chain" TEXT,
    "address" TEXT,
    "city_name" TEXT,
    "city_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cinemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "ingresso_session_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "cinema_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "room_type" TEXT NOT NULL,
    "room_label" TEXT,
    "room_name" TEXT,
    "audio" "AudioType" NOT NULL DEFAULT 'desconhecido',
    "is_3d" BOOLEAN NOT NULL DEFAULT false,
    "session_kind" "SessionKind" NOT NULL DEFAULT 'regular',
    "purchase_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availabilities" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "source" "AvailabilitySource" NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "initial" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "accent_secondary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_title_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "status" "UserTitleStatus" NOT NULL,
    "wanted_at" TIMESTAMPTZ(3),
    "marked_at" TIMESTAMPTZ(3),
    "watched_at" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL DEFAULT 'app',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_title_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "facet" "TagFacet" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "origin" "TagOrigin" NOT NULL,
    "owner_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_tags" (
    "title_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "origin" "TagOrigin" NOT NULL,
    "added_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "title_tags_pkey" PRIMARY KEY ("title_id","tag_id")
);

-- CreateTable
CREATE TABLE "match_decisions" (
    "id" TEXT NOT NULL,
    "ingresso_event_id" TEXT NOT NULL,
    "ingresso_title" TEXT NOT NULL,
    "ingresso_year" INTEGER,
    "normalized_query" TEXT,
    "stage" "MatchStage" NOT NULL,
    "outcome" "MatchOutcome" NOT NULL,
    "candidate_tmdb_id" INTEGER,
    "candidate_title_id" TEXT,
    "candidate_label" TEXT,
    "score_total" DOUBLE PRECISION,
    "score_title" DOUBLE PRECISION,
    "score_runtime" DOUBLE PRECISION,
    "score_year" DOUBLE PRECISION,
    "score_credits" DOUBLE PRECISION,
    "threshold_used" DOUBLE PRECISION,
    "result_title_id" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "sync_run_id" TEXT,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_items" (
    "id" TEXT NOT NULL,
    "ingresso_event_id" TEXT NOT NULL,
    "ingresso_title" TEXT NOT NULL,
    "ingresso_year" INTEGER,
    "ingresso_payload" JSONB,
    "subject_title_id" TEXT,
    "candidate_title_id" TEXT,
    "candidate_tmdb_id" INTEGER,
    "candidate_label" TEXT,
    "candidate_payload" JSONB,
    "score" DOUBLE PRECISION,
    "reason" "ReviewReason" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'open',
    "resolution" "ReviewResolution",
    "resolved_title_id" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_payloads_source_endpoint_fetched_at_idx" ON "raw_payloads"("source", "endpoint", "fetched_at");

-- CreateIndex
CREATE INDEX "raw_payloads_body_hash_idx" ON "raw_payloads"("body_hash");

-- CreateIndex
CREATE INDEX "raw_payloads_sync_run_id_idx" ON "raw_payloads"("sync_run_id");

-- CreateIndex
CREATE INDEX "sync_runs_job_type_started_at_idx" ON "sync_runs"("job_type", "started_at");

-- CreateIndex
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

-- CreateIndex
CREATE INDEX "canary_checks_layer_target_checked_at_idx" ON "canary_checks"("layer", "target", "checked_at");

-- CreateIndex
CREATE INDEX "canary_checks_passed_checked_at_idx" ON "canary_checks"("passed", "checked_at");

-- CreateIndex
CREATE INDEX "alerts_fingerprint_resolved_at_idx" ON "alerts"("fingerprint", "resolved_at");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "titles_status_idx" ON "titles"("status");

-- CreateIndex
CREATE INDEX "titles_media_type_status_idx" ON "titles"("media_type", "status");

-- CreateIndex
CREATE INDEX "titles_year_idx" ON "titles"("year");

-- CreateIndex
CREATE INDEX "titles_normalized_title_idx" ON "titles" USING GIN ("normalized_title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "titles_normalized_original_title_idx" ON "titles" USING GIN ("normalized_original_title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "title_external_ids_title_id_source_idx" ON "title_external_ids"("title_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "title_external_ids_source_external_id_key" ON "title_external_ids"("source", "external_id");

-- CreateIndex
CREATE INDEX "title_aliases_from_title_id_idx" ON "title_aliases"("from_title_id");

-- CreateIndex
CREATE INDEX "title_aliases_to_title_id_idx" ON "title_aliases"("to_title_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_tmdb_id_key" ON "people"("tmdb_id");

-- CreateIndex
CREATE INDEX "people_name_idx" ON "people"("name");

-- CreateIndex
CREATE INDEX "title_credits_title_id_role_order_idx" ON "title_credits"("title_id", "role", "order");

-- CreateIndex
CREATE UNIQUE INDEX "title_credits_title_id_person_id_role_key" ON "title_credits"("title_id", "person_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "genres_tmdb_id_key" ON "genres"("tmdb_id");

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE INDEX "title_genres_genre_id_idx" ON "title_genres"("genre_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tmdb_id_key" ON "companies"("tmdb_id");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE INDEX "title_companies_company_id_idx" ON "title_companies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cinemas_ingresso_id_key" ON "cinemas"("ingresso_id");

-- CreateIndex
CREATE INDEX "cinemas_city_id_active_idx" ON "cinemas"("city_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_ingresso_session_id_key" ON "sessions"("ingresso_session_id");

-- CreateIndex
CREATE INDEX "sessions_title_id_starts_at_idx" ON "sessions"("title_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_cinema_id_starts_at_idx" ON "sessions"("cinema_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_starts_at_active_idx" ON "sessions"("starts_at", "active");

-- CreateIndex
CREATE INDEX "sessions_session_kind_starts_at_idx" ON "sessions"("session_kind", "starts_at");

-- CreateIndex
CREATE INDEX "availabilities_source_status_ended_at_idx" ON "availabilities"("source", "status", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "availabilities_title_id_source_status_key" ON "availabilities"("title_id", "source", "status");

-- CreateIndex
CREATE INDEX "user_title_states_user_id_status_idx" ON "user_title_states"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_title_states_title_id_idx" ON "user_title_states"("title_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_title_states_user_id_title_id_key" ON "user_title_states"("user_id", "title_id");

-- CreateIndex
CREATE INDEX "tags_facet_origin_idx" ON "tags"("facet", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "tags_facet_value_owner_id_key" ON "tags"("facet", "value", "owner_id");

-- CreateIndex
CREATE INDEX "title_tags_tag_id_idx" ON "title_tags"("tag_id");

-- CreateIndex
CREATE INDEX "title_tags_origin_idx" ON "title_tags"("origin");

-- CreateIndex
CREATE INDEX "match_decisions_ingresso_event_id_decided_at_idx" ON "match_decisions"("ingresso_event_id", "decided_at");

-- CreateIndex
CREATE INDEX "match_decisions_stage_outcome_decided_at_idx" ON "match_decisions"("stage", "outcome", "decided_at");

-- CreateIndex
CREATE INDEX "match_decisions_sync_run_id_idx" ON "match_decisions"("sync_run_id");

-- CreateIndex
CREATE INDEX "review_items_status_created_at_idx" ON "review_items"("status", "created_at");

-- CreateIndex
CREATE INDEX "review_items_ingresso_event_id_idx" ON "review_items"("ingresso_event_id");

-- CreateIndex
CREATE INDEX "review_items_reason_idx" ON "review_items"("reason");

-- AddForeignKey
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canary_checks" ADD CONSTRAINT "canary_checks_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_canary_check_id_fkey" FOREIGN KEY ("canary_check_id") REFERENCES "canary_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_external_ids" ADD CONSTRAINT "title_external_ids_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_external_ids" ADD CONSTRAINT "title_external_ids_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_aliases" ADD CONSTRAINT "title_aliases_from_title_id_fkey" FOREIGN KEY ("from_title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_aliases" ADD CONSTRAINT "title_aliases_to_title_id_fkey" FOREIGN KEY ("to_title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_aliases" ADD CONSTRAINT "title_aliases_merged_by_id_fkey" FOREIGN KEY ("merged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_credits" ADD CONSTRAINT "title_credits_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_credits" ADD CONSTRAINT "title_credits_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_genres" ADD CONSTRAINT "title_genres_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_genres" ADD CONSTRAINT "title_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_companies" ADD CONSTRAINT "title_companies_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_companies" ADD CONSTRAINT "title_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cinema_id_fkey" FOREIGN KEY ("cinema_id") REFERENCES "cinemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availabilities" ADD CONSTRAINT "availabilities_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_title_states" ADD CONSTRAINT "user_title_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_title_states" ADD CONSTRAINT "user_title_states_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_tags" ADD CONSTRAINT "title_tags_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_tags" ADD CONSTRAINT "title_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_candidate_title_id_fkey" FOREIGN KEY ("candidate_title_id") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_result_title_id_fkey" FOREIGN KEY ("result_title_id") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_subject_title_id_fkey" FOREIGN KEY ("subject_title_id") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_candidate_title_id_fkey" FOREIGN KEY ("candidate_title_id") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_title_id_fkey" FOREIGN KEY ("resolved_title_id") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Índices parciais: regras de integridade que o Prisma não declara.
-- Ver prisma/MIGRATIONS.md para o porquê de cada um.
-- ─────────────────────────────────────────────────────────────

-- 1. Um Title não pode acumular dois tmdb_id.
CREATE UNIQUE INDEX IF NOT EXISTS "title_external_ids_one_tmdb_per_title"
  ON "title_external_ids" ("title_id")
  WHERE "source" = 'tmdb';

-- 2. Tags automáticas não podem duplicar (owner_id NULL escapa do unique comum).
CREATE UNIQUE INDEX IF NOT EXISTS "tags_unique_auto"
  ON "tags" ("facet", "value")
  WHERE "owner_id" IS NULL;

-- 3. Um alerta aberto por fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_one_open_per_fingerprint"
  ON "alerts" ("fingerprint")
  WHERE "resolved_at" IS NULL;

-- 4. Um item de revisão aberto por evento do ingresso.
CREATE UNIQUE INDEX IF NOT EXISTS "review_items_one_open_per_event"
  ON "review_items" ("ingresso_event_id")
  WHERE "status" = 'open';
