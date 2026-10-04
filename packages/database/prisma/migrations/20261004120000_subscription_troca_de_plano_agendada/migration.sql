-- Troca de plano agendada para o proximo ciclo (#337). Colunas nulas: nenhuma
-- assinatura existente muda de comportamento.
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_id" UUID;
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_from" TIMESTAMP(3);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_scheduled_plan_ambos_ou_nenhum"
  CHECK (("scheduled_plan_id" IS NULL) = ("scheduled_plan_from" IS NULL));
