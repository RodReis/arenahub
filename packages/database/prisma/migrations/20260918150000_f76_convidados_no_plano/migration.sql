-- F76 (ADR-059/ADR-060): convidados no plano.
--
-- Plano ganha limite mensal de convidados (nulo = sem o beneficio, e todo
-- plano existente E -- migration nao concede convidado a ninguem por
-- omissao). Cada uso vira uma linha em guest_passes, com nome e CPF do
-- convidado: nao e um contador solto (decisao do PI, SPEC-076 2).

-- AlterTable
ALTER TABLE "plans" ADD COLUMN "guest_passes_per_month" INTEGER;

-- CreateTable
CREATE TABLE "guest_passes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_cpf" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_passes_tenant_id_subscription_id_used_at_idx" ON "guest_passes"("tenant_id", "subscription_id", "used_at");

-- AddForeignKey
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
