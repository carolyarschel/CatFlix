-- "Marcar como assistido" a partir do ingresso (pedido da Carol, 20/11/2026).
-- Só acrescenta: o cinema e o formato da sala da sessão (para a visualização
-- cair no cinema certo) e a visualização que o ingresso virou.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "cinema_id" TEXT,
ADD COLUMN     "room_label" TEXT,
ADD COLUMN     "watch_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_watch_id_key" ON "tickets"("watch_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_cinema_id_fkey" FOREIGN KEY ("cinema_id") REFERENCES "cinemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Os ingressos que já existem herdam o cinema da sessão deles.
UPDATE "tickets" t
SET "cinema_id" = s."cinema_id"
FROM "sessions" s
WHERE s."id" = t."session_id" AND t."cinema_id" IS NULL;
