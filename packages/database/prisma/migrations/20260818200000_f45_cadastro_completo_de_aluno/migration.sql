-- F45 -- Cadastro completo de aluno (retrabalho da Slice 1.2)
--
-- Passo 1 de 3. Aqui NADA e obrigatorio: a coluna `gym_unit_id` nasce
-- ANULAVEL de proposito. Ha alunos cadastrados desde a F7 sem unidade, e
-- coluna NOT NULL numa tabela populada falha na hora ou inventa valor.
-- O backfill e o `SET NOT NULL` vem nas migrations seguintes.

-- Tipos novos -------------------------------------------------------------

CREATE TYPE "student_registered_sex" AS ENUM ('FEMALE', 'MALE', 'NOT_INFORMED');

CREATE TYPE "lead_source" AS ENUM (
  'INDICACAO',
  'REDES_SOCIAIS',
  'PASSAGEM_NA_PORTA',
  'CAMPANHA',
  'SITE',
  'OUTRO'
);

ALTER TYPE "student_contact_type" ADD VALUE 'EMERGENCY';

-- Alunos ------------------------------------------------------------------

ALTER TABLE "students"
  ADD COLUMN "rg"              TEXT,
  ADD COLUMN "registered_sex"  "student_registered_sex",
  ADD COLUMN "lead_source"     "lead_source",
  ADD COLUMN "advisor_user_id" UUID,
  ADD COLUMN "gym_unit_id"     UUID;

-- `RESTRICT`: apagar unidade que ainda tem aluno falha, em vez de deixar
-- aluno orfao. `SET NULL` no consultor: o aluno continua existindo depois
-- que o funcionario sai.
ALTER TABLE "students"
  ADD CONSTRAINT "students_gym_unit_id_fkey"
    FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "students_advisor_user_id_fkey"
    FOREIGN KEY ("advisor_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "students_tenant_id_gym_unit_id_idx"
  ON "students"("tenant_id", "gym_unit_id");

-- Contato de emergencia ---------------------------------------------------
-- Reaproveita `student_contacts` com dois campos opcionais em vez de uma
-- quarta tabela para guardar tres strings.

ALTER TABLE "student_contacts"
  ADD COLUMN "label"        TEXT,
  ADD COLUMN "relationship" TEXT;
