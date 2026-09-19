-- F77 (ADR-061): agenda de aulas -- grade recorrente, professor e
-- capacidade.
--
-- `Class` e a grade recorrente por unidade; `ClassException` cobre "cancelar
-- uma ocorrencia" e "trocar o professor de um dia especifico" sem desfazer
-- a grade. Professor (`trainer_id`) e OPCIONAL e UNICO por aula, e a grade
-- NAO tem validade de temporada -- decisoes do PI de 18/09/2026 (pendencia
-- da SPEC-077 3.1).

-- CreateEnum
CREATE TYPE "class_exception_type" AS ENUM ('CANCELLED', 'TRAINER_OVERRIDE');

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "modality_id" UUID NOT NULL,
    "trainer_id" UUID,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_exceptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "type" "class_exception_type" NOT NULL,
    "override_trainer_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classes_tenant_id_gym_unit_id_day_of_week_idx" ON "classes"("tenant_id", "gym_unit_id", "day_of_week");

-- CreateIndex
CREATE INDEX "classes_tenant_id_trainer_id_idx" ON "classes"("tenant_id", "trainer_id");

-- CreateIndex
CREATE INDEX "class_exceptions_tenant_id_class_id_idx" ON "class_exceptions"("tenant_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_exceptions_class_id_occurrence_date_key" ON "class_exceptions"("class_id", "occurrence_date");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_modality_id_fkey" FOREIGN KEY ("modality_id") REFERENCES "gym_unit_modalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_exceptions" ADD CONSTRAINT "class_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_exceptions" ADD CONSTRAINT "class_exceptions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_exceptions" ADD CONSTRAINT "class_exceptions_override_trainer_id_fkey" FOREIGN KEY ("override_trainer_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
