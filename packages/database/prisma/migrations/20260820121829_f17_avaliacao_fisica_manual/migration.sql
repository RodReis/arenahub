-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "measurement_source" AS ENUM ('MANUAL', 'DEVICE', 'IMPORT');

-- CreateEnum
CREATE TYPE "health_context_factor" AS ENUM ('SUPLEMENTACAO_CREATINA', 'COMPOSICAO_ATIPICA', 'GESTANTE_OU_POS_PARTO', 'EDEMA_RELATADO', 'USO_DE_DIURETICO', 'ATLETA_COMPETITIVO');

-- CreateEnum
CREATE TYPE "body_measurement_type" AS ENUM ('WEIGHT', 'HEIGHT', 'BODY_FAT_PERCENT', 'BODY_FAT_MASS', 'LEAN_BODY_MASS', 'SKELETAL_MUSCLE_MASS', 'TOTAL_BODY_WATER', 'INTRACELLULAR_WATER', 'EXTRACELLULAR_WATER', 'PROTEIN_MASS', 'MINERAL_MASS', 'VISCERAL_FAT_LEVEL', 'BASAL_METABOLIC_RATE', 'WAIST_CIRCUMFERENCE', 'HIP_CIRCUMFERENCE');

-- CreateEnum
CREATE TYPE "measurement_unit" AS ENUM ('KG', 'G', 'LB', 'CM', 'M', 'IN', 'PERCENT', 'KCAL', 'L');

-- AlterEnum
ALTER TYPE "consent_document_type" ADD VALUE 'HEALTH';

-- CreateTable
CREATE TABLE "body_assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "assessment_status" NOT NULL DEFAULT 'DRAFT',
    "assessed_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "source" "measurement_source" NOT NULL DEFAULT 'MANUAL',
    "source_reference" TEXT,
    "evaluator_user_id" UUID NOT NULL,
    "supersedes_assessment_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "type" "body_measurement_type" NOT NULL,
    "original_value" DECIMAL(10,4) NOT NULL,
    "original_unit" "measurement_unit",
    "canonical_value" DECIMAL(10,4) NOT NULL,
    "canonical_unit" "measurement_unit",
    "source" "measurement_source" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_health_context" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "factor" "health_context_factor" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_health_context_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "body_assessments_supersedes_assessment_id_key" ON "body_assessments"("supersedes_assessment_id");

-- CreateIndex
CREATE INDEX "body_assessments_tenant_id_student_id_assessed_at_idx" ON "body_assessments"("tenant_id", "student_id", "assessed_at");

-- CreateIndex
CREATE INDEX "body_assessments_tenant_id_student_id_status_published_at_idx" ON "body_assessments"("tenant_id", "student_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "body_measurements_tenant_id_assessment_id_idx" ON "body_measurements"("tenant_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "body_measurements_assessment_id_type_key" ON "body_measurements"("assessment_id", "type");

-- CreateIndex
CREATE INDEX "student_health_context_tenant_id_student_id_factor_idx" ON "student_health_context"("tenant_id", "student_id", "factor");

-- AddForeignKey
ALTER TABLE "body_assessments" ADD CONSTRAINT "body_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_assessments" ADD CONSTRAINT "body_assessments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_assessments" ADD CONSTRAINT "body_assessments_evaluator_user_id_fkey" FOREIGN KEY ("evaluator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_assessments" ADD CONSTRAINT "body_assessments_supersedes_assessment_id_fkey" FOREIGN KEY ("supersedes_assessment_id") REFERENCES "body_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "body_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health_context" ADD CONSTRAINT "student_health_context_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health_context" ADD CONSTRAINT "student_health_context_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health_context" ADD CONSTRAINT "student_health_context_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
