-- CreateEnum
CREATE TYPE "xp_trigger" AS ENUM ('SESSAO_CONFIRMADA');

-- CreateEnum
CREATE TYPE "xp_entry_type" AS ENUM ('GRANT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "xp_rule_status" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "xp_source_kind" AS ENUM ('ATTENDANCE_SESSION', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "achievement_criterion_kind" AS ENUM ('SESSOES_ACUMULADAS');

-- CreateEnum
CREATE TYPE "achievement_status" AS ENUM ('UNLOCKED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ranking_snapshot_status" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHHELD');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ranking_minimum_cohort" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "xp_rule_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "trigger" "xp_trigger" NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "xp_rule_status" NOT NULL DEFAULT 'APPROVED',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "xp_entry_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "source_kind" "xp_source_kind" NOT NULL,
    "source_id" TEXT NOT NULL,
    "reverses_entry_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "local_month" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_xp_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "local_month" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "last_entry_at" TIMESTAMP(3) NOT NULL,
    "rebuilt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_xp_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_definition_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "criterion_kind" "achievement_criterion_kind" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_definition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_achievements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "definition_version_id" UUID NOT NULL,
    "status" "achievement_status" NOT NULL DEFAULT 'UNLOCKED',
    "unlocked_at" TIMESTAMP(3) NOT NULL,
    "evidence_entry_id" UUID NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversed_reason" TEXT,

    CONSTRAINT "student_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "local_month" TEXT NOT NULL,
    "status" "ranking_snapshot_status" NOT NULL DEFAULT 'DRAFT',
    "minimum_cohort" INTEGER NOT NULL,
    "eligible_count" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_entries" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "last_entry_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranking_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "xp_rule_versions_tenant_id_trigger_effective_from_idx" ON "xp_rule_versions"("tenant_id", "trigger", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "xp_rule_versions_tenant_id_code_version_key" ON "xp_rule_versions"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "xp_ledger_entries_tenant_id_student_id_local_month_idx" ON "xp_ledger_entries"("tenant_id", "student_id", "local_month");

-- CreateIndex
CREATE INDEX "xp_ledger_entries_tenant_id_local_month_idx" ON "xp_ledger_entries"("tenant_id", "local_month");

-- CreateIndex
CREATE UNIQUE INDEX "xp_ledger_entries_tenant_id_student_id_source_kind_source_i_key" ON "xp_ledger_entries"("tenant_id", "student_id", "source_kind", "source_id", "rule_version_id", "type");

-- CreateIndex
CREATE INDEX "student_xp_balances_tenant_id_local_month_points_idx" ON "student_xp_balances"("tenant_id", "local_month", "points");

-- CreateIndex
CREATE UNIQUE INDEX "student_xp_balances_tenant_id_student_id_local_month_key" ON "student_xp_balances"("tenant_id", "student_id", "local_month");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_definition_versions_tenant_id_code_version_key" ON "achievement_definition_versions"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "student_achievements_tenant_id_student_id_status_idx" ON "student_achievements"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_achievements_tenant_id_student_id_definition_versio_key" ON "student_achievements"("tenant_id", "student_id", "definition_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_snapshots_tenant_id_gym_unit_id_local_month_key" ON "ranking_snapshots"("tenant_id", "gym_unit_id", "local_month");

-- CreateIndex
CREATE INDEX "ranking_entries_snapshot_id_position_idx" ON "ranking_entries"("snapshot_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_entries_snapshot_id_student_id_key" ON "ranking_entries"("snapshot_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_entries_snapshot_id_position_key" ON "ranking_entries"("snapshot_id", "position");

-- AddForeignKey
ALTER TABLE "xp_rule_versions" ADD CONSTRAINT "xp_rule_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "xp_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "xp_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_xp_balances" ADD CONSTRAINT "student_xp_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_xp_balances" ADD CONSTRAINT "student_xp_balances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_definition_versions" ADD CONSTRAINT "achievement_definition_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_achievements" ADD CONSTRAINT "student_achievements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_achievements" ADD CONSTRAINT "student_achievements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_achievements" ADD CONSTRAINT "student_achievements_definition_version_id_fkey" FOREIGN KEY ("definition_version_id") REFERENCES "achievement_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_achievements" ADD CONSTRAINT "student_achievements_evidence_entry_id_fkey" FOREIGN KEY ("evidence_entry_id") REFERENCES "xp_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ranking_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only de verdade: o ledger nao aceita UPDATE nem DELETE.
--
-- Sem isto, "append-only" e uma promessa que a primeira correcao apressada
-- quebra sem deixar rastro. Manutencao emergencial usa role separada e
-- runbook, nao a credencial da aplicacao.
CREATE OR REPLACE FUNCTION arenahub_bloquear_mutacao_de_ledger()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'XP_LEDGER_APPEND_ONLY: % em xp_ledger_entries e proibido; use movimento compensatorio', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER xp_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON xp_ledger_entries
FOR EACH ROW EXECUTE FUNCTION arenahub_bloquear_mutacao_de_ledger();
