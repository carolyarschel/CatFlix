-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('flatrate', 'free', 'ads', 'rent', 'buy');

-- AlterTable
ALTER TABLE "titles" ADD COLUMN     "providers_updated_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "streaming_providers" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "streaming_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "title_providers" (
    "title_id" TEXT NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "display_priority" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "title_providers_pkey" PRIMARY KEY ("title_id","provider_id","region","type")
);

-- CreateIndex
CREATE INDEX "title_providers_title_id_region_idx" ON "title_providers"("title_id", "region");

-- AddForeignKey
ALTER TABLE "title_providers" ADD CONSTRAINT "title_providers_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_providers" ADD CONSTRAINT "title_providers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "streaming_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

