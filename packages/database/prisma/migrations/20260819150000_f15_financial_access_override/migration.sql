-- F15 -- liberacao financeira excepcional com prazo. Slice 2.4.
--
-- NAO E O `manual_access_overrides` DA F9, e a diferenca importa:
--
--   - o da F9 e por PASSAGEM: amarrado a um `access_event_id`, a recepcao abre
--     a catraca para quem esta na frente dela, uma vez;
--   - este e por PERIODO: vale para toda tentativa ate expirar, e existe para
--     o caso "o aluno jura que pagou, o PIX ainda nao caiu".
--
-- Reusar o da F9 obrigaria a recepcao a repetir a liberacao a cada entrada
-- durante tres dias, o que na pratica vira ninguem conferir mais nada.
--
-- EXPIRA SOZINHO: nao ha job. `expires_at` e comparado com o instante da
-- tentativa no momento da leitura -- liberacao que depende de alguem lembrar
-- de desligar vira permanente por esquecimento.
--
-- `revoked_at` em vez de DELETE: a liberacao aconteceu, e quem a concedeu
-- responde por ela. Apagar tiraria da auditoria justamente o registro que ela
-- existe para guardar.
--
-- Tabela nova, sem backfill: nao existe liberacao anterior a esta fatia.

CREATE TABLE "financial_access_overrides" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "actor_id" UUID NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "financial_access_overrides_pkey" PRIMARY KEY ("id")
);

-- A consulta do caminho de acesso: "ha liberacao viva para este aluno agora?".
-- Ela roda em TODA tentativa de passagem negada por divida, entao o indice nao
-- e otimizacao prematura -- e o caminho quente da catraca.
CREATE INDEX "financial_access_overrides_tenant_student_expires_idx"
  ON "financial_access_overrides" ("tenant_id", "student_id", "expires_at");

ALTER TABLE "financial_access_overrides"
  ADD CONSTRAINT "financial_access_overrides_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_access_overrides"
  ADD CONSTRAINT "financial_access_overrides_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
