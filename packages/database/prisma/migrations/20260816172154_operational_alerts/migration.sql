-- CreateEnum
CREATE TYPE "operational_alert_state" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "operational_alert_severity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateTable
CREATE TABLE "operational_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID,
    "fingerprint" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "operational_alert_severity" NOT NULL,
    "state" "operational_alert_state" NOT NULL DEFAULT 'OPEN',
    "resource" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operational_alerts_fingerprint_key" ON "operational_alerts"("fingerprint");

-- CreateIndex
CREATE INDEX "operational_alerts_tenant_id_state_severity_last_seen_at_idx" ON "operational_alerts"("tenant_id", "state", "severity", "last_seen_at");

-- CreateIndex
CREATE INDEX "operational_alerts_tenant_id_gym_unit_id_state_idx" ON "operational_alerts"("tenant_id", "gym_unit_id", "state");

-- AddForeignKey
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
