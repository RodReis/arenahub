-- F36 / SPEC-036 -- Contrato de dados e baseline analitica (Slice 6.1).
--
-- ADITIVA: so cria enum e tabela nova. Nao altera nem remove nada existente,
-- entao nao ha backfill -- e o PRD 9 proibe justamente o backfill que
-- interessaria aqui: feature ausente NAO vira zero.


-- CreateEnum
CREATE TYPE "retention_missing_reason" AS ENUM ('NO_HISTORY', 'SOURCE_UNAVAILABLE', 'NOT_APPLICABLE', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "retention_feature_provenance" AS ENUM ('AS_OF', 'CURRENT_STATE');

-- CreateTable
CREATE TABLE "retention_target_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "feature_window_days" INTEGER NOT NULL,
    "prediction_days" INTEGER NOT NULL,
    "confirmation_days" INTEGER NOT NULL,
    "frozen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_target_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_feature_set_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "feature_names" TEXT[],
    "frozen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_feature_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_feature_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "target_version_id" UUID NOT NULL,
    "feature_set_version_id" UUID NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "knowledge_cutoff_at" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "completeness" DECIMAL(5,4) NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_feature_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_feature_values" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(18,6),
    "missing_reason" "retention_missing_reason",
    "provenance" "retention_feature_provenance" NOT NULL DEFAULT 'AS_OF',

    CONSTRAINT "student_feature_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_target_versions_tenant_id_label_key" ON "retention_target_versions"("tenant_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "retention_feature_set_versions_tenant_id_label_key" ON "retention_feature_set_versions"("tenant_id", "label");

-- CreateIndex
CREATE INDEX "student_feature_snapshots_tenant_id_observed_at_idx" ON "student_feature_snapshots"("tenant_id", "observed_at");

-- CreateIndex
CREATE INDEX "student_feature_snapshots_tenant_id_student_id_observed_at_idx" ON "student_feature_snapshots"("tenant_id", "student_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_feature_snapshots_tenant_id_student_id_observed_at__key" ON "student_feature_snapshots"("tenant_id", "student_id", "observed_at", "target_version_id", "feature_set_version_id", "revision");

-- CreateIndex
CREATE INDEX "student_feature_values_tenant_id_name_missing_reason_idx" ON "student_feature_values"("tenant_id", "name", "missing_reason");

-- CreateIndex
CREATE UNIQUE INDEX "student_feature_values_snapshot_id_name_key" ON "student_feature_values"("snapshot_id", "name");

-- AddForeignKey
ALTER TABLE "retention_target_versions" ADD CONSTRAINT "retention_target_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_feature_set_versions" ADD CONSTRAINT "retention_feature_set_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feature_snapshots" ADD CONSTRAINT "student_feature_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feature_snapshots" ADD CONSTRAINT "student_feature_snapshots_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feature_snapshots" ADD CONSTRAINT "student_feature_snapshots_target_version_id_fkey" FOREIGN KEY ("target_version_id") REFERENCES "retention_target_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feature_snapshots" ADD CONSTRAINT "student_feature_snapshots_feature_set_version_id_fkey" FOREIGN KEY ("feature_set_version_id") REFERENCES "retention_feature_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_feature_values" ADD CONSTRAINT "student_feature_values_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "student_feature_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

