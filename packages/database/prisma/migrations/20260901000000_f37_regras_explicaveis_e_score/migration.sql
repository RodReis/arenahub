-- CreateEnum
CREATE TYPE "retention_rule_direction" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "retention_rule_operator" AS ENUM ('GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'PERCENT_DROP_AT_LEAST');

-- CreateEnum
CREATE TYPE "retention_risk_band" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "retention_score_provider" AS ENUM ('RULE_BASELINE', 'SUPERVISED_MODEL');

-- CreateEnum
CREATE TYPE "retention_ineligibility_reason" AS ENUM ('CANCELLED', 'SUPPRESSED', 'INSUFFICIENT_HISTORY');

-- CreateEnum
CREATE TYPE "retention_suppression_reason" AS ENUM ('OPT_OUT', 'DELETION_PENDING', 'MANUAL_WITH_REASON');

-- CreateTable
CREATE TABLE "retention_rule_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "critical_floor" INTEGER NOT NULL DEFAULT 75,
    "high_floor" INTEGER NOT NULL DEFAULT 50,
    "medium_floor" INTEGER NOT NULL DEFAULT 25,
    "minimum_completeness" DECIMAL(5,4) NOT NULL DEFAULT 0.3,
    "frozen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "feature_name" TEXT NOT NULL,
    "operator" "retention_rule_operator" NOT NULL,
    "threshold" DECIMAL(18,6) NOT NULL,
    "weight" INTEGER NOT NULL,
    "direction" "retention_rule_direction" NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "retention_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_scores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "provider" "retention_score_provider" NOT NULL DEFAULT 'RULE_BASELINE',
    "value" INTEGER NOT NULL,
    "band" "retention_risk_band" NOT NULL,
    "completeness" DECIMAL(5,4) NOT NULL,
    "calibrated_probability" DECIMAL(5,4),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_score_factors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "score_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "feature_name" TEXT NOT NULL,
    "observed_value" DECIMAL(18,6) NOT NULL,
    "contribution" INTEGER NOT NULL,
    "direction" "retention_rule_direction" NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "retention_score_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_score_skips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "reason" "retention_ineligibility_reason" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_score_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_suppressions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reason" "retention_suppression_reason" NOT NULL,
    "note" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_rule_versions_tenant_id_label_key" ON "retention_rule_versions"("tenant_id", "label");

-- CreateIndex
CREATE INDEX "retention_rules_tenant_id_rule_version_id_idx" ON "retention_rules"("tenant_id", "rule_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_rules_rule_version_id_feature_name_operator_thres_key" ON "retention_rules"("rule_version_id", "feature_name", "operator", "threshold");

-- CreateIndex
CREATE INDEX "retention_scores_tenant_id_observed_at_value_idx" ON "retention_scores"("tenant_id", "observed_at", "value");

-- CreateIndex
CREATE INDEX "retention_scores_tenant_id_student_id_calculated_at_idx" ON "retention_scores"("tenant_id", "student_id", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "retention_scores_snapshot_id_provider_rule_version_id_key" ON "retention_scores"("snapshot_id", "provider", "rule_version_id");

-- CreateIndex
CREATE INDEX "retention_score_factors_tenant_id_feature_name_idx" ON "retention_score_factors"("tenant_id", "feature_name");

-- CreateIndex
CREATE UNIQUE INDEX "retention_score_factors_score_id_position_key" ON "retention_score_factors"("score_id", "position");

-- CreateIndex
CREATE INDEX "retention_score_skips_tenant_id_observed_at_reason_idx" ON "retention_score_skips"("tenant_id", "observed_at", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "retention_score_skips_snapshot_id_key" ON "retention_score_skips"("snapshot_id");

-- CreateIndex
CREATE INDEX "retention_suppressions_tenant_id_student_id_ends_at_idx" ON "retention_suppressions"("tenant_id", "student_id", "ends_at");

-- AddForeignKey
ALTER TABLE "retention_rule_versions" ADD CONSTRAINT "retention_rule_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_rules" ADD CONSTRAINT "retention_rules_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "retention_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_scores" ADD CONSTRAINT "retention_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_scores" ADD CONSTRAINT "retention_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_scores" ADD CONSTRAINT "retention_scores_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "student_feature_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_scores" ADD CONSTRAINT "retention_scores_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "retention_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_score_factors" ADD CONSTRAINT "retention_score_factors_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "retention_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_score_skips" ADD CONSTRAINT "retention_score_skips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_score_skips" ADD CONSTRAINT "retention_score_skips_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_score_skips" ADD CONSTRAINT "retention_score_skips_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "student_feature_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_suppressions" ADD CONSTRAINT "retention_suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_suppressions" ADD CONSTRAINT "retention_suppressions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `M6-BR-007`: supressao manual exige motivo registrado. O Prisma nao expressa
-- condicional entre colunas, entao a garantia mora aqui -- e nao num `if` do
-- servico, que a proxima chamada de outro lugar contorna sem perceber.
ALTER TABLE "retention_suppressions"
  ADD CONSTRAINT "retention_suppressions_manual_requires_note"
  CHECK ("reason" <> 'MANUAL_WITH_REASON' OR ("note" IS NOT NULL AND btrim("note") <> ''));

-- O score e uma ORDENACAO em [0, 100], nunca uma probabilidade. Um peso mal
-- somado que estourasse a faixa passaria calado pela tela: 140 desenha igual a
-- 100 numa pilula de texto.
ALTER TABLE "retention_scores"
  ADD CONSTRAINT "retention_scores_value_range" CHECK ("value" BETWEEN 0 AND 100);

-- Ate cinco fatores por score -- PRD §16.
ALTER TABLE "retention_score_factors"
  ADD CONSTRAINT "retention_score_factors_position_range" CHECK ("position" BETWEEN 1 AND 5);

-- Peso e sempre positivo; quem da o sinal e a direcao. Peso negativo com
-- direcao DECREASE inverteria o sentido duas vezes e a explicacao mostraria um
-- fator protetor aumentando o risco.
ALTER TABLE "retention_rules"
  ADD CONSTRAINT "retention_rules_weight_positive" CHECK ("weight" > 0);

-- Os pisos das faixas sobem na ordem. Trocados, `faixaDoScore` devolveria
-- CRITICO para score baixo, e o teste do dominio nao pega porque a versao vem
-- do banco.
ALTER TABLE "retention_rule_versions"
  ADD CONSTRAINT "retention_rule_versions_bands_ordered"
  CHECK ("medium_floor" > 0 AND "high_floor" > "medium_floor" AND "critical_floor" > "high_floor" AND "critical_floor" <= 100);
