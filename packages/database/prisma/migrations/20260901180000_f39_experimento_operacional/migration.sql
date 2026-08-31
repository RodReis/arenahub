-- CreateEnum
CREATE TYPE "retention_experiment_status" AS ENUM ('DRAFT', 'RUNNING', 'CLOSED');

-- CreateEnum
CREATE TYPE "retention_experiment_group" AS ENUM ('CONTROL', 'TREATMENT');

-- CreateEnum
CREATE TYPE "retention_adverse_effect" AS ENUM ('OPT_OUT', 'CANCELLED', 'DECLINED', 'SUPPRESSION_REQUESTED');

-- CreateTable
CREATE TABLE "retention_experiments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "retention_experiment_status" NOT NULL DEFAULT 'DRAFT',
    "seed" TEXT NOT NULL,
    "control_fraction" DECIMAL(5,4) NOT NULL DEFAULT 0.2,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_experiment_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "assigned_group" "retention_experiment_group" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_experiment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_experiment_adverse_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "effect" "retention_adverse_effect" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_experiment_adverse_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retention_experiments_tenant_id_status_idx" ON "retention_experiments"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "retention_experiments_tenant_id_label_key" ON "retention_experiments"("tenant_id", "label");

-- CreateIndex
CREATE INDEX "retention_experiment_assignments_tenant_id_experiment_id_as_idx" ON "retention_experiment_assignments"("tenant_id", "experiment_id", "assigned_group");

-- CreateIndex
CREATE UNIQUE INDEX "retention_experiment_assignments_experiment_id_student_id_key" ON "retention_experiment_assignments"("experiment_id", "student_id");

-- CreateIndex
CREATE INDEX "retention_experiment_adverse_events_tenant_id_experiment_id_idx" ON "retention_experiment_adverse_events"("tenant_id", "experiment_id", "effect");

-- CreateIndex
CREATE UNIQUE INDEX "retention_experiment_adverse_events_experiment_id_student_i_key" ON "retention_experiment_adverse_events"("experiment_id", "student_id", "effect");

-- AddForeignKey
ALTER TABLE "retention_experiments" ADD CONSTRAINT "retention_experiments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_experiment_assignments" ADD CONSTRAINT "retention_experiment_assignments_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "retention_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_experiment_assignments" ADD CONSTRAINT "retention_experiment_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_experiment_assignments" ADD CONSTRAINT "retention_experiment_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_experiment_adverse_events" ADD CONSTRAINT "retention_experiment_adverse_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_experiment_adverse_events" ADD CONSTRAINT "retention_experiment_adverse_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- `M6-FR-012`: o desenho congela ao iniciar.
-- ---------------------------------------------------------------------------
--
-- Um CHECK nao consegue comparar a linha nova com a antiga, entao a garantia de
-- imutabilidade e um TRIGGER. Ele existe porque a guarda no servico e uma
-- porta: qualquer outro caminho de escrita -- correcao manual, script de
-- migracao, um `update` esquecido -- passaria por fora dela e moveria alunos de
-- grupo sem deixar rastro.
--
-- Mudar `seed` ou `control_fraction` depois de RUNNING re-sorteia TODO mundo na
-- proxima leitura, porque o grupo e derivado desses dois. E exatamente o
-- cherry-picking que o aceite da Slice 6.4 proibe: rodar, ver o resultado,
-- mexer na semente e rodar de novo ate o numero agradar.
CREATE OR REPLACE FUNCTION retention_experiment_congelado()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.seed IS DISTINCT FROM OLD.seed
       OR NEW.control_fraction IS DISTINCT FROM OLD.control_fraction
       OR NEW.window_days IS DISTINCT FROM OLD.window_days THEN
      RAISE EXCEPTION 'EXPERIMENTO_CONGELADO: seed, control_fraction e window_days nao mudam apos DRAFT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retention_experiments_congelado
  BEFORE UPDATE ON "retention_experiments"
  FOR EACH ROW EXECUTE FUNCTION retention_experiment_congelado();

-- A alocacao NUNCA muda de grupo. Mesmo motivo do trigger acima, e este e o
-- mais direto: um `UPDATE ... SET assigned_group` seria a forma mais simples de
-- forjar o resultado.
CREATE OR REPLACE FUNCTION retention_assignment_imutavel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_group IS DISTINCT FROM OLD.assigned_group
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.experiment_id IS DISTINCT FROM OLD.experiment_id THEN
    RAISE EXCEPTION 'ALOCACAO_IMUTAVEL: grupo, aluno e experimento nao mudam apos a alocacao';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retention_experiment_assignments_imutavel
  BEFORE UPDATE ON "retention_experiment_assignments"
  FOR EACH ROW EXECUTE FUNCTION retention_assignment_imutavel();

-- Fracao de controle em [0, 1]. Fora disso, `sortearGrupo` lanca -- mas o dado
-- ja teria entrado, e o experimento so quebraria na primeira alocacao.
ALTER TABLE "retention_experiments"
  ADD CONSTRAINT "retention_experiments_fracao_valida"
  CHECK ("control_fraction" >= 0 AND "control_fraction" <= 1);

-- Janela positiva. Zero mediria permanencia no instante da alocacao, que e
-- sempre 100% e nunca diz nada.
ALTER TABLE "retention_experiments"
  ADD CONSTRAINT "retention_experiments_janela_positiva"
  CHECK ("window_days" > 0);

-- Semente nao vazia: string vazia daria hash constante por aluno e a divisao
-- deixaria de re-embaralhar entre experimentos.
ALTER TABLE "retention_experiments"
  ADD CONSTRAINT "retention_experiments_semente_presente"
  CHECK (btrim("seed") <> '');

-- RUNNING e CLOSED exigem data de inicio. Sem ela nao ha de onde contar a
-- janela, e o relatorio mediria janelas diferentes por aluno sem perceber.
ALTER TABLE "retention_experiments"
  ADD CONSTRAINT "retention_experiments_iniciado_tem_data"
  CHECK ("status" = 'DRAFT' OR "started_at" IS NOT NULL);
