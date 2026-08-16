-- CreateEnum
CREATE TYPE "data_export_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "data_export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "data_export_status" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "object_key" TEXT,
    "error_code" TEXT,
    "expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_export_jobs_tenant_id_status_created_at_idx" ON "data_export_jobs"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_export_jobs_tenant_id_requester_id_idempotency_key_key" ON "data_export_jobs"("tenant_id", "requester_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
