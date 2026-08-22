-- F-multiarquivo -- avaliacao com varios arquivos (ADR-038).
--
-- Hoje um arquivo produz uma avaliacao (1:1). Quando a academia envia 3
-- arquivos da MESMA medicao (balanca de bioimpedancia, app de leitura da
-- mesma balanca, ECG), isso criaria 3 avaliacoes para 1 medicao real e o
-- grafico de evolucao mentiria. Esta migracao inverte a relacao para N:1:
-- varios `assessment_imports` apontam para UMA `body_assessments`,
-- agrupados por `review_session_id`.
--
-- NENHUM DROP COLUMN, NENHUM DELETE. So dado a acrescentar; a unica coisa
-- removida e o INDEX UNIQUE que forcava 1:1 -- que e o proprio ponto desta
-- fatia. Migracao puramente estrutural: `assessment_imports` e da F19 (a
-- migracao mais recente antes desta) e o seed nao tem nenhuma linha nessa
-- tabela, entao nao ha dado existente para converter.

-- 1. OS 19 TIPOS DE MEDIDA NOVOS (Task 1 do dominio).
--
-- `ALTER TYPE ... ADD VALUE` nao pode ser usado na MESMA transacao em que o
-- valor novo e referenciado (restricao do Postgres, historicamente exigia
-- rodar fora de bloco de transacao). Aqui cada `ADD VALUE` e a UNICA coisa
-- feita com o valor nesta migracao -- nenhuma linha e gravada usando estes
-- tipos no mesmo arquivo -- entao rodar dentro da transacao do
-- `prisma migrate` e seguro. Ainda assim: esta migracao NAO PODE ser
-- espremida (squash) numa unica transacao junto de outra que LEIA um destes
-- valores novos, ou o Postgres rejeita em tempo de execucao.
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_FAT_MASS_ARM_LEFT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_FAT_MASS_ARM_RIGHT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_FAT_MASS_TRUNK';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_FAT_MASS_LEG_LEFT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_FAT_MASS_LEG_RIGHT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_MUSCLE_MASS_ARM_LEFT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_MUSCLE_MASS_ARM_RIGHT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_MUSCLE_MASS_TRUNK';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_MUSCLE_MASS_LEG_LEFT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SEGMENTAL_MUSCLE_MASS_LEG_RIGHT';
ALTER TYPE "body_measurement_type" ADD VALUE 'BONE_MASS';
ALTER TYPE "body_measurement_type" ADD VALUE 'BODY_CELL_MASS';
ALTER TYPE "body_measurement_type" ADD VALUE 'SUBCUTANEOUS_FAT_MASS';
ALTER TYPE "body_measurement_type" ADD VALUE 'SUBCUTANEOUS_FAT_PERCENT';
ALTER TYPE "body_measurement_type" ADD VALUE 'SKELETAL_MUSCLE_PERCENT';
ALTER TYPE "body_measurement_type" ADD VALUE 'MUSCLE_MASS';
ALTER TYPE "body_measurement_type" ADD VALUE 'PROTEIN_PERCENT';
ALTER TYPE "body_measurement_type" ADD VALUE 'WAIST_HIP_RATIO';
ALTER TYPE "body_measurement_type" ADD VALUE 'HEART_RATE';

-- 2. `body_assessments`: campos DO APARELHO, que nao sao medida.
ALTER TABLE "body_assessments"
  ADD COLUMN "device_report" JSONB,
  ADD COLUMN "device_model"  TEXT,
  ADD COLUMN "device_serial" TEXT;

-- 3. `assessment_imports`: de 1:1 para N:1 com `body_assessments`.
--
-- O UNIQUE em `assessment_id` e o que forcava "um arquivo = uma avaliacao".
-- Derruba-lo e o proprio ponto da fatia: agora varios arquivos da mesma
-- sessao de revisao podem apontar para a mesma avaliacao.
DROP INDEX "assessment_imports_assessment_id_key";

ALTER TABLE "assessment_imports"
  ADD COLUMN "review_session_id" UUID,
  ADD COLUMN "source_label"      TEXT;

CREATE INDEX "assessment_imports_tenant_id_review_session_id_idx"
  ON "assessment_imports" ("tenant_id", "review_session_id");

-- 4. `imported_fields`: origem do arquivo, concordancia entre arquivos e
-- faixa de referencia do laudo.
ALTER TABLE "imported_fields"
  ADD COLUMN "source_label"        TEXT,
  ADD COLUMN "agrees_with_field_id" UUID,
  ADD COLUMN "reference_min"       DECIMAL(10,4),
  ADD COLUMN "reference_max"       DECIMAL(10,4),
  ADD COLUMN "standard_percent"    DECIMAL(7,2);

CREATE INDEX "imported_fields_import_id_agrees_with_field_id_idx"
  ON "imported_fields" ("import_id", "agrees_with_field_id");
