-- F34 -- Desafios e avisos (Slice 5.5, ADR-048)
--
-- Quatro tabelas novas, nenhuma alteracao em tabela existente.
--
-- Escrita a partir de `prisma migrate diff`, com o ruido REMOVIDO A MAO: o
-- diff tambem trazia `ALTER COLUMN "id" DROP DEFAULT` em seis tabelas e o
-- recriar das FKs de `public_profiles`. Isso e divergencia PRE-EXISTENTE
-- entre as migrations da F21/F30 e o schema, nao tem relacao com esta fatia,
-- e arrastar junto faria uma migration de desafios mexer em tabela de perfil
-- publico -- exatamente o tipo de alteracao que ninguem espera encontrar
-- revisando "F34".

-- CreateEnum
CREATE TYPE "challenge_metric" AS ENUM ('SESSOES_NA_JANELA');

-- CreateEnum
CREATE TYPE "challenge_status" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "challenge_participant_status" AS ENUM ('JOINED', 'LEFT', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "challenge_notice_kind" AS ENUM ('DISPONIVEL', 'CONCLUIDO', 'ENCERRADO_SEM_META');

-- CreateTable
CREATE TABLE "challenge_template_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "metric" "challenge_metric" NOT NULL,
    "max_sessions_per_week" INTEGER NOT NULL,
    "max_window_days" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "challenge_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "gym_unit_id" UUID,
    "title" TEXT NOT NULL,
    "status" "challenge_status" NOT NULL DEFAULT 'DRAFT',
    "target_value" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "challenge_participant_status" NOT NULL DEFAULT 'JOINED',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_notices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" "challenge_notice_kind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

CONSTRAINT "challenge_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "challenge_template_versions_tenant_id_effective_from_idx" ON "challenge_template_versions"("tenant_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_template_versions_tenant_id_code_version_key" ON "challenge_template_versions"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "challenges_tenant_id_status_starts_on_idx" ON "challenges"("tenant_id", "status", "starts_on");

-- CreateIndex
CREATE INDEX "challenges_tenant_id_gym_unit_id_status_idx" ON "challenges"("tenant_id", "gym_unit_id", "status");

-- CreateIndex
CREATE INDEX "challenge_participants_tenant_id_student_id_status_idx" ON "challenge_participants"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_participants_challenge_id_student_id_key" ON "challenge_participants"("challenge_id", "student_id");

-- CreateIndex
CREATE INDEX "challenge_notices_tenant_id_student_id_read_at_idx" ON "challenge_notices"("tenant_id", "student_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_notices_challenge_id_student_id_kind_key" ON "challenge_notices"("challenge_id", "student_id", "kind");

-- AddForeignKey
ALTER TABLE "challenge_template_versions" ADD CONSTRAINT "challenge_template_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "challenge_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_notices" ADD CONSTRAINT "challenge_notices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_notices" ADD CONSTRAINT "challenge_notices_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_notices" ADD CONSTRAINT "challenge_notices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
