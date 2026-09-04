-- CreateTable
CREATE TABLE "gym_unit_modalities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_unit_modalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_modalities" (
    "student_id" UUID NOT NULL,
    "modality_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_modalities_pkey" PRIMARY KEY ("student_id","modality_id")
);

-- CreateIndex
CREATE INDEX "gym_unit_modalities_tenant_id_idx" ON "gym_unit_modalities"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gym_unit_modalities_gym_unit_id_name_key" ON "gym_unit_modalities"("gym_unit_id", "name");

-- CreateIndex
CREATE INDEX "student_modalities_tenant_id_idx" ON "student_modalities"("tenant_id");

-- CreateIndex
CREATE INDEX "student_modalities_modality_id_idx" ON "student_modalities"("modality_id");

-- AddForeignKey
ALTER TABLE "gym_unit_modalities" ADD CONSTRAINT "gym_unit_modalities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_unit_modalities" ADD CONSTRAINT "gym_unit_modalities_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_modalities" ADD CONSTRAINT "student_modalities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_modalities" ADD CONSTRAINT "student_modalities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_modalities" ADD CONSTRAINT "student_modalities_modality_id_fkey" FOREIGN KEY ("modality_id") REFERENCES "gym_unit_modalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CARGA INICIAL -- decisao do PI em 04/09/2026.
--
-- Toda unidade existente ganha a modalidade "Academia - Clinica de
-- Musculacao", e todo aluno com `profile = 'STUDENT'` e vinculado a
-- modalidade DA PROPRIA UNIDADE. Sem isso a base inteira ficaria sem
-- modalidade, e a tela nova nasceria mentindo sobre a operacao real.
--
-- FORA DA CARGA: `ADMIN`, `STAFF` e `TRAINER`. Professor e funcionario nao
-- sao aluno de modalidade nenhuma -- o acesso deles vem do vinculo, nao de
-- matricula em atividade.
--
-- IDEMPOTENTE nos dois passos (`ON CONFLICT DO NOTHING`): a mesma migration
-- roda em desenvolvimento e em producao, e rodar duas vezes nao duplica
-- modalidade nem vinculo.
INSERT INTO "gym_unit_modalities" ("id", "tenant_id", "gym_unit_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), u."tenant_id", u."id", 'Academia - Clínica de Musculação', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "gym_units" u
ON CONFLICT ("gym_unit_id", "name") DO NOTHING;

INSERT INTO "student_modalities" ("student_id", "modality_id", "tenant_id", "created_at")
SELECT s."id", m."id", s."tenant_id", CURRENT_TIMESTAMP
FROM "students" s
JOIN "gym_unit_modalities" m
  ON m."gym_unit_id" = s."gym_unit_id"
 AND m."name" = 'Academia - Clínica de Musculação'
WHERE s."profile" = 'STUDENT'
ON CONFLICT ("student_id", "modality_id") DO NOTHING;
