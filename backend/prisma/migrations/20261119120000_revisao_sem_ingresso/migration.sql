-- AlterEnum
ALTER TYPE "ExternalSource" ADD VALUE 'cronicas_gatur';

-- AlterEnum
ALTER TYPE "ReviewReason" ADD VALUE 'import_low_confidence';

-- AlterTable
ALTER TABLE "review_items" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'ingresso',
ALTER COLUMN "ingresso_event_id" DROP NOT NULL;

