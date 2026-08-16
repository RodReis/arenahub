-- CreateEnum
CREATE TYPE "consent_document_type" AS ENUM ('BIOMETRIC');

-- CreateEnum
CREATE TYPE "consent_decision" AS ENUM ('ACCEPTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "consent_subject_kind" AS ENUM ('STUDENT', 'LEGAL_GUARDIAN');

-- CreateEnum
CREATE TYPE "biometric_identity_state" AS ENUM ('ACTIVE', 'REVOKED', 'DELETION_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "edge_node_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "device_kind" AS ENUM ('FACIAL_READER', 'TURNSTILE');

-- CreateEnum
CREATE TYPE "device_user_state" AS ENUM ('PENDING', 'SYNCED', 'REMOVAL_PENDING', 'REMOVED', 'FAILED');

-- CreateEnum
CREATE TYPE "device_sync_operation" AS ENUM ('UPSERT', 'DELETE');

-- CreateEnum
CREATE TYPE "device_sync_job_state" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'RETRYING', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "device_command_state" AS ENUM ('AVAILABLE', 'LEASED', 'ACKNOWLEDGED', 'FAILED');

-- CreateEnum
CREATE TYPE "biometric_access_kind" AS ENUM ('ENROLLMENT_IMAGE', 'IDENTITY_METADATA');

-- CreateEnum
CREATE TYPE "biometric_access_purpose" AS ENUM ('ENROLLMENT', 'DEVICE_SYNC', 'REVOCATION', 'PURGE', 'AUDIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_CONSENT_ACCEPTED';
ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_CONSENT_REFUSED';
ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_CONSENT_REVOKED';
ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_IDENTITY_CREATED';
ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_IDENTITY_REVOKED';
ALTER TYPE "student_timeline_event_type" ADD VALUE 'BIOMETRIC_IDENTITY_DELETED';

-- CreateTable
CREATE TABLE "consent_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "type" "consent_document_type" NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "decision" "consent_decision" NOT NULL,
    "subject_kind" "consent_subject_kind" NOT NULL,
    "guardian_name" TEXT,
    "guardian_relation" TEXT,
    "subject_age_years" INTEGER NOT NULL,
    "actor_id" UUID,
    "actor_ip" TEXT,
    "actor_user_agent" TEXT,
    "evidence" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "revokes_record_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_identities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "state" "biometric_identity_state" NOT NULL DEFAULT 'ACTIVE',
    "consent_record_id" UUID NOT NULL,
    "enrollment_object_key" TEXT,
    "enrollment_purged_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "biometric_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_access_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "kind" "biometric_access_kind" NOT NULL,
    "purpose" "biometric_access_purpose" NOT NULL,
    "actor_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_ip" TEXT,
    "correlation_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_privacy_settings" (
    "tenant_id" UUID NOT NULL,
    "purge_after_days" INTEGER NOT NULL DEFAULT 30,
    "access_log_retention_days" INTEGER NOT NULL DEFAULT 1825,
    "processing_instructions" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_privacy_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "edge_nodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "edge_node_status" NOT NULL DEFAULT 'ACTIVE',
    "agent_version" TEXT,
    "last_heartbeat" TIMESTAMP(3),
    "clock_offset_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edge_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "edge_node_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "active_from" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_nonces" (
    "id" UUID NOT NULL,
    "edge_node_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "edge_node_id" UUID,
    "kind" "device_kind" NOT NULL,
    "model" TEXT NOT NULL,
    "firmware" TEXT,
    "serial" TEXT NOT NULL,
    "status" "device_status" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" JSONB,
    "last_heartbeat" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "state" "device_user_state" NOT NULL DEFAULT 'PENDING',
    "synced_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "operation" "device_sync_operation" NOT NULL,
    "state" "device_sync_job_state" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "error_code" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "edge_node_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "device_command_state" NOT NULL DEFAULT 'AVAILABLE',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leased_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_documents_tenant_id_type_effective_from_idx" ON "consent_documents"("tenant_id", "type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "consent_documents_tenant_id_type_version_key" ON "consent_documents"("tenant_id", "type", "version");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_student_id_occurred_at_idx" ON "consent_records"("tenant_id", "student_id", "occurred_at");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_document_id_idx" ON "consent_records"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "biometric_identities_tenant_id_student_id_state_idx" ON "biometric_identities"("tenant_id", "student_id", "state");

-- CreateIndex
CREATE INDEX "biometric_identities_tenant_id_state_idx" ON "biometric_identities"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "biometric_access_logs_tenant_id_identity_id_occurred_at_idx" ON "biometric_access_logs"("tenant_id", "identity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "biometric_access_logs_tenant_id_occurred_at_idx" ON "biometric_access_logs"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "edge_nodes_tenant_id_gym_unit_id_idx" ON "edge_nodes"("tenant_id", "gym_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "edge_nodes_tenant_id_code_key" ON "edge_nodes"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "edge_credentials_key_id_key" ON "edge_credentials"("key_id");

-- CreateIndex
CREATE INDEX "edge_credentials_tenant_id_edge_node_id_revoked_at_idx" ON "edge_credentials"("tenant_id", "edge_node_id", "revoked_at");

-- CreateIndex
CREATE INDEX "replay_nonces_expires_at_idx" ON "replay_nonces"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "replay_nonces_edge_node_id_key_id_nonce_hash_key" ON "replay_nonces"("edge_node_id", "key_id", "nonce_hash");

-- CreateIndex
CREATE INDEX "devices_tenant_id_gym_unit_id_status_idx" ON "devices"("tenant_id", "gym_unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_serial_key" ON "devices"("tenant_id", "serial");

-- CreateIndex
CREATE INDEX "device_users_tenant_id_state_idx" ON "device_users"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "device_users_tenant_id_student_id_idx" ON "device_users"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_users_device_id_external_user_id_key" ON "device_users"("device_id", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_users_device_id_identity_id_key" ON "device_users"("device_id", "identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_sync_jobs_idempotency_key_key" ON "device_sync_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "device_sync_jobs_tenant_id_state_next_attempt_at_idx" ON "device_sync_jobs"("tenant_id", "state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "device_sync_jobs_tenant_id_identity_id_idx" ON "device_sync_jobs"("tenant_id", "identity_id");

-- CreateIndex
CREATE INDEX "device_sync_jobs_tenant_id_device_id_state_idx" ON "device_sync_jobs"("tenant_id", "device_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "device_commands_idempotency_key_key" ON "device_commands"("idempotency_key");

-- CreateIndex
CREATE INDEX "device_commands_edge_node_id_state_sequence_idx" ON "device_commands"("edge_node_id", "state", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "device_commands_edge_node_id_sequence_key" ON "device_commands"("edge_node_id", "sequence");

-- AddForeignKey
ALTER TABLE "consent_documents" ADD CONSTRAINT "consent_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "consent_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_identities" ADD CONSTRAINT "biometric_identities_consent_record_id_fkey" FOREIGN KEY ("consent_record_id") REFERENCES "consent_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_access_logs" ADD CONSTRAINT "biometric_access_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_privacy_settings" ADD CONSTRAINT "tenant_privacy_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_nodes" ADD CONSTRAINT "edge_nodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_credentials" ADD CONSTRAINT "edge_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_credentials" ADD CONSTRAINT "edge_credentials_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_nonces" ADD CONSTRAINT "replay_nonces_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "biometric_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_jobs" ADD CONSTRAINT "device_sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_jobs" ADD CONSTRAINT "device_sync_jobs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_jobs" ADD CONSTRAINT "device_sync_jobs_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "biometric_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
