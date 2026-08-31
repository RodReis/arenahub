-- CreateEnum
CREATE TYPE "retention_task_status" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "retention_task_result" AS ENUM ('CONTACTED', 'NO_ANSWER', 'CHANNEL_UNAVAILABLE', 'DECLINED', 'FOLLOW_UP', 'RESOLVED_OTHER');

-- CreateEnum
CREATE TYPE "retention_contact_channel" AS ENUM ('WHATSAPP');

-- CreateTable
CREATE TABLE "retention_capacity_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "daily_capacity" INTEGER NOT NULL DEFAULT 20,
    "cooldown_days" INTEGER NOT NULL DEFAULT 14,
    "sla_business_days" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_capacity_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score_id" UUID NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" "retention_task_status" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "result" "retention_task_result",
    "dismiss_reason" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "retention_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_interactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "channel" "retention_contact_channel" NOT NULL,
    "result" "retention_task_result" NOT NULL,
    "notes" TEXT,
    "next_step" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_capacity_policies_gym_unit_id_key" ON "retention_capacity_policies"("gym_unit_id");

-- CreateIndex
CREATE INDEX "retention_capacity_policies_tenant_id_idx" ON "retention_capacity_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "retention_tasks_tenant_id_gym_unit_id_status_due_at_idx" ON "retention_tasks"("tenant_id", "gym_unit_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "retention_tasks_tenant_id_student_id_created_at_idx" ON "retention_tasks"("tenant_id", "student_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "retention_tasks_score_id_key" ON "retention_tasks"("score_id");

-- CreateIndex
CREATE INDEX "retention_interactions_tenant_id_task_id_occurred_at_idx" ON "retention_interactions"("tenant_id", "task_id", "occurred_at");

-- CreateIndex
CREATE INDEX "retention_interactions_tenant_id_occurred_at_idx" ON "retention_interactions"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "retention_capacity_policies" ADD CONSTRAINT "retention_capacity_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_capacity_policies" ADD CONSTRAINT "retention_capacity_policies_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_tasks" ADD CONSTRAINT "retention_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_tasks" ADD CONSTRAINT "retention_tasks_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_tasks" ADD CONSTRAINT "retention_tasks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_tasks" ADD CONSTRAINT "retention_tasks_score_id_fkey" FOREIGN KEY ("score_id") REFERENCES "retention_scores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_interactions" ADD CONSTRAINT "retention_interactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_interactions" ADD CONSTRAINT "retention_interactions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "retention_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- `M6-FR-007`: NO MAXIMO UMA TAREFA ATIVA por aluno e estrategia.
-- ---------------------------------------------------------------------------
--
-- O `@@unique([score_id])` do Prisma garante coisa DIFERENTE: que um score nao
-- gere duas tarefas. Nao impede que dois scores de dias diferentes -- que e o
-- caso normal, o pipeline roda todo dia -- gerem duas tarefas ativas para o
-- mesmo aluno pelo mesmo motivo. Sem este indice, o aluno recebe duas ligacoes.
--
-- O predicado repete `ESTADOS_ATIVOS` de `tarefa-de-retencao.ts`, e ha teste de
-- dominio comparando a lista com o predicado `estaAtiva` justamente porque as
-- duas definicoes divergirem em silencio e como o defeito voltaria.
--
-- PARCIAL, e nao unique simples: tarefa CONCLUIDA/DISPENSADA/EXPIRADA precisa
-- poder coexistir com uma nova -- o historico e append-only, e o aluno pode ser
-- contatado de novo depois do cooldown.
--
-- O lado da relacao importa (lição da F31): a linha e a TAREFA, e a cardinalidade
-- que se quer e "uma ativa por (tenant, aluno, estrategia)", nao por score.
CREATE UNIQUE INDEX "retention_tasks_uma_ativa_por_aluno_e_estrategia"
  ON "retention_tasks" ("tenant_id", "student_id", "strategy")
  WHERE "status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS');

-- Concluir exige resultado; dispensar exige motivo (`M6-AC-006`, `M6-FR-009`).
-- A maquina de estados ja recusa, mas ela e uma porta: outro caminho de escrita
-- (correcao manual, script de migracao) passaria por fora. O CHECK nao passa.
ALTER TABLE "retention_tasks"
  ADD CONSTRAINT "retention_tasks_concluida_exige_resultado"
  CHECK ("status" <> 'COMPLETED' OR "result" IS NOT NULL);

ALTER TABLE "retention_tasks"
  ADD CONSTRAINT "retention_tasks_dispensada_exige_motivo"
  CHECK (
    "status" <> 'DISMISSED'
    OR ("dismiss_reason" IS NOT NULL AND btrim("dismiss_reason") <> '')
  );

-- Tarefa atribuida ou em atendimento tem dono. Sem isso, uma fila "em
-- atendimento" sem responsavel esconderia exatamente o que `M6-AC-006` quer
-- amarrar: quem falou com o aluno.
ALTER TABLE "retention_tasks"
  ADD CONSTRAINT "retention_tasks_ativa_com_dono_tem_responsavel"
  CHECK ("status" NOT IN ('ASSIGNED', 'IN_PROGRESS') OR "assignee_id" IS NOT NULL);

-- Capacidade e cooldown positivos; SLA nao negativo. Capacidade zero pararia a
-- fila inteira em silencio, e a recepcao veria "nenhum aluno em risco" quando o
-- que houve foi um numero errado na configuracao.
ALTER TABLE "retention_capacity_policies"
  ADD CONSTRAINT "retention_capacity_policies_limites_sensatos"
  CHECK ("daily_capacity" > 0 AND "cooldown_days" > 0 AND "sla_business_days" >= 0);
