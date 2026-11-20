-- Ingresso comprado para uma sessão (pedido da Carol, 20/11/2026): a sessão,
-- os códigos de resgate e o lembrete por push 30 minutos antes.
-- Só acrescenta: uma tabela nova.

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "session_id" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "cinema_name" TEXT NOT NULL,
    "details" TEXT,
    "codes" TEXT[],
    "created_by" "Pessoa" NOT NULL,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_session_id_key" ON "tickets"("session_id");

-- CreateIndex
CREATE INDEX "tickets_title_id_idx" ON "tickets"("title_id");

-- CreateIndex
CREATE INDEX "tickets_starts_at_idx" ON "tickets"("starts_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
