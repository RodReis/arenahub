-- F56 / SPEC-056: plano com assinatura mensal (ADR-043, Decisoes 2 e 5).

-- Modalidade de cobranca do plano.
CREATE TYPE "plan_billing_mode" AS ENUM ('AVULSO', 'ASSINATURA');

-- `AVULSO` como padrao NAO e detalhe: e o que todo plano existente ja E.
-- Qualquer outro default cobraria, no proximo ciclo, aluno que nunca
-- autorizou recorrencia.
ALTER TABLE "plans"
  ADD COLUMN "billing_mode" "plan_billing_mode" NOT NULL DEFAULT 'AVULSO';

-- Id da RECORRENCIA no provedor -- a fonte que `CancelarRecorrenciaUseCase`
-- esperava desde 25/08/2026 (ADR-043, Decisao 5). Anulavel: assinatura de
-- plano AVULSO nunca tem, e plano ASSINATURA so tem depois da adesao.
ALTER TABLE "subscriptions"
  ADD COLUMN "external_subscription_id" TEXT,
  ADD COLUMN "recurrence_consent_at" TIMESTAMP(3),
  ADD COLUMN "recurrence_consent_actor_id" UUID;

-- O job de cobranca automatica le por aqui.
CREATE INDEX "subscriptions_tenant_id_external_subscription_id_idx"
  ON "subscriptions" ("tenant_id", "external_subscription_id");

-- UMA recorrencia viva por assinatura, e o mesmo id nunca em duas.
--
-- Indice PARCIAL porque a coluna e anulavel e NULL nao colide em UNIQUE do
-- Postgres -- sem o filtro, o indice existiria mas nao garantiria nada sobre
-- as linhas que importam. Adesao concorrente na mesma assinatura passa a
-- perder no banco, nao num `if` que le antes de escrever (foi assim que a
-- F53 cobrou o aluno em dobro).
CREATE UNIQUE INDEX "subscriptions_external_subscription_id_key"
  ON "subscriptions" ("external_subscription_id")
  WHERE "external_subscription_id" IS NOT NULL;
