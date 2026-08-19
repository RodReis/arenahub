-- CreateEnum
CREATE TYPE "refund_access_policy" AS ENUM ('KEEP_UNTIL_PERIOD_END', 'SUSPEND_ON_CONFIRMATION');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('REQUESTED', 'PROCESSING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "reconciliation_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "external_movement_kind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "reconciliation_item_status" AS ENUM ('MATCHED', 'MISSING_INTERNAL', 'MISSING_EXTERNAL', 'AMOUNT_MISMATCH', 'RESOLVED');

-- CreateEnum
CREATE TYPE "reconciliation_resolution" AS ENUM ('REPROCESS_PROVIDER_EVENT', 'ACCEPT_DOCUMENTED_DIFFERENCE');

-- AlterTable
ALTER TABLE "billing_settings" ADD COLUMN     "discount_limit_minor" INTEGER,
ADD COLUMN     "manual_payment_limit_minor" INTEGER,
ADD COLUMN     "refund_access_policy" "refund_access_policy" NOT NULL DEFAULT 'KEEP_UNTIL_PERIOD_END',
ADD COLUMN     "refund_limit_minor" INTEGER;

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "refund_status" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "applied_access_policy" "refund_access_policy",
    "idempotency_key" TEXT NOT NULL,
    "external_refund_id" TEXT,
    "failure_code" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "verification_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_sequences" (
    "tenant_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_account_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "reconciliation_run_status" NOT NULL DEFAULT 'RUNNING',
    "movements_imported" INTEGER NOT NULL DEFAULT 0,
    "items_open" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "external_movement_id" TEXT NOT NULL,
    "external_payment_id" TEXT,
    "external_account_id" TEXT NOT NULL,
    "kind" "external_movement_kind" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "reconciliation_item_status" NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "external_movement_id" TEXT,
    "internal_amount_minor" INTEGER,
    "external_amount_minor" INTEGER,
    "recommended_action" TEXT NOT NULL,
    "resolution" "reconciliation_resolution",
    "resolution_reason" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_tenant_id_payment_id_status_idx" ON "refunds"("tenant_id", "payment_id", "status");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_status_requested_at_idx" ON "refunds"("tenant_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_tenant_id_idempotency_key_key" ON "refunds"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_number_key" ON "receipts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "reconciliation_runs_tenant_id_started_at_idx" ON "reconciliation_runs"("tenant_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_tenant_id_provider_account_id_period_st_key" ON "reconciliation_runs"("tenant_id", "provider_account_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "external_movements_tenant_id_external_payment_id_idx" ON "external_movements"("tenant_id", "external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_movements_tenant_id_external_movement_id_key" ON "external_movements"("tenant_id", "external_movement_id");

-- CreateIndex
CREATE INDEX "reconciliation_items_tenant_id_status_created_at_idx" ON "reconciliation_items"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_items_tenant_id_run_id_idx" ON "reconciliation_items"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "provider_accounts_tenant_id_capability_active_idx" ON "provider_accounts"("tenant_id", "capability", "active");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_movements" ADD CONSTRAINT "external_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_movements" ADD CONSTRAINT "external_movements_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NO MAXIMO UM estorno em voo por pagamento.
--
-- Indice PARCIAL, escrito a mao porque o Prisma nao modela unicidade
-- condicional -- o `@@index` do schema serve so ao planner; a garantia e esta.
--
-- POR QUE EXISTE, EM UMA FRASE: a F14 cobrou um aluno em dobro porque a
-- exclusao mutua vivia num `if` do codigo, e entre a leitura e a escrita cabe
-- a segunda requisicao. Aqui o erro seria DEVOLVER o dinheiro duas vezes.
-- Um `if (jaExiste)` perderia a mesma corrida; o banco nao perde.
--
-- Parcial de proposito: estorno FAILED nao trava o proximo (uma falha
-- transitoria do provedor precisa poder ser tentada de novo), e CONFIRMED nao
-- trava o estorno parcial seguinte, que e caso legitimo.
CREATE UNIQUE INDEX "refunds_payment_id_em_voo_key"
  ON "refunds" ("payment_id")
  WHERE "status" IN ('REQUESTED', 'PROCESSING');
