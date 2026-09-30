-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "batch_request_hash" TEXT;

-- CreateIndex
CREATE INDEX "payments_tenant_id_batch_id_idx" ON "payments"("tenant_id", "batch_id");
