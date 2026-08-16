-- CreateEnum
CREATE TYPE "access_outcome" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "access_reason" AS ENUM ('ACTIVE_ENTITLEMENT', 'ADMIN_BLOCK', 'STUDENT_BLOCKED', 'STUDENT_INACTIVE', 'NO_ENTITLEMENT', 'WRONG_UNIT', 'OUTSIDE_SCHEDULE');

-- CreateEnum
CREATE TYPE "access_mode" AS ENUM ('ONLINE', 'OFFLINE', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "access_method" AS ENUM ('FACIAL', 'QR', 'CARD', 'PIN', 'MANUAL');

-- CreateEnum
CREATE TYPE "passage_state" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'CONFIRMED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "access_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_blocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" UUID,
    "lift_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "edge_node_id" UUID,
    "device_id" UUID,
    "student_id" UUID,
    "identity_id" UUID,
    "external_user_id" TEXT,
    "recognition_id" TEXT,
    "outcome" "access_outcome" NOT NULL,
    "reason" "access_reason" NOT NULL,
    "entitlement_id" UUID,
    "valid_until" TIMESTAMP(3),
    "policy_version" TEXT NOT NULL,
    "mode" "access_mode" NOT NULL,
    "method" "access_method" NOT NULL,
    "recognized_at" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_passages" (
    "id" UUID NOT NULL,
    "access_event_id" UUID NOT NULL,
    "state" "passage_state" NOT NULL,
    "command_id" TEXT,
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_event_corrections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "original_event_id" UUID NOT NULL,
    "correcting_event_id" UUID,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_event_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_access_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "student_id" UUID,
    "visitor_description" TEXT,
    "device_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "access_event_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_access_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_policies_tenant_id_gym_unit_id_starts_at_idx" ON "access_policies"("tenant_id", "gym_unit_id", "starts_at");

-- CreateIndex
CREATE INDEX "administrative_blocks_tenant_id_student_id_lifted_at_starts_idx" ON "administrative_blocks"("tenant_id", "student_id", "lifted_at", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "access_events_tenant_id_gym_unit_id_occurred_at_idx" ON "access_events"("tenant_id", "gym_unit_id", "occurred_at");

-- CreateIndex
CREATE INDEX "access_events_tenant_id_student_id_occurred_at_idx" ON "access_events"("tenant_id", "student_id", "occurred_at");

-- CreateIndex
CREATE INDEX "access_events_tenant_id_outcome_occurred_at_idx" ON "access_events"("tenant_id", "outcome", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_events_edge_node_id_idempotency_key_key" ON "access_events"("edge_node_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "access_passages_access_event_id_key" ON "access_passages"("access_event_id");

-- CreateIndex
CREATE INDEX "access_event_corrections_tenant_id_original_event_id_idx" ON "access_event_corrections"("tenant_id", "original_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "manual_access_overrides_access_event_id_key" ON "manual_access_overrides"("access_event_id");

-- CreateIndex
CREATE INDEX "manual_access_overrides_tenant_id_gym_unit_id_created_at_idx" ON "manual_access_overrides"("tenant_id", "gym_unit_id", "created_at");

-- AddForeignKey
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_blocks" ADD CONSTRAINT "administrative_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_blocks" ADD CONSTRAINT "administrative_blocks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "biometric_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_passages" ADD CONSTRAINT "access_passages_access_event_id_fkey" FOREIGN KEY ("access_event_id") REFERENCES "access_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event_corrections" ADD CONSTRAINT "access_event_corrections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event_corrections" ADD CONSTRAINT "access_event_corrections_original_event_id_fkey" FOREIGN KEY ("original_event_id") REFERENCES "access_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event_corrections" ADD CONSTRAINT "access_event_corrections_correcting_event_id_fkey" FOREIGN KEY ("correcting_event_id") REFERENCES "access_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_overrides" ADD CONSTRAINT "manual_access_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_overrides" ADD CONSTRAINT "manual_access_overrides_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_overrides" ADD CONSTRAINT "manual_access_overrides_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_overrides" ADD CONSTRAINT "manual_access_overrides_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_access_overrides" ADD CONSTRAINT "manual_access_overrides_access_event_id_fkey" FOREIGN KEY ("access_event_id") REFERENCES "access_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
