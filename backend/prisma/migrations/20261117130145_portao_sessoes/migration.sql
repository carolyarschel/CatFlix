-- CreateTable
CREATE TABLE "portao_sessoes" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "usuario" JSONB NOT NULL,
    "sid" TEXT,
    "id_token" TEXT NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portao_sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portao_sessoes_sid_idx" ON "portao_sessoes"("sid");

-- CreateIndex
CREATE INDEX "portao_sessoes_usuario_id_idx" ON "portao_sessoes"("usuario_id");

-- CreateIndex
CREATE INDEX "portao_sessoes_expira_em_idx" ON "portao_sessoes"("expira_em");

