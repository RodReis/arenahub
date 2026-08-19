-- F14 -- metodo de pagamento tokenizado. `MVP-02` 7, Slice 2.3.
--
-- O QUE ESTA TABELA NAO TEM, E NUNCA PODE TER (INV-098): numero do cartao,
-- PAN, CVV, trilha. A tokenizacao e HOSPEDADA -- o dado vai do navegador do
-- aluno direto para o provedor, e o backend recebe so o token. Coluna de PAN
-- aqui nao seria "campo faltando": seria o ArenaHub entrando no escopo do
-- PCI DSS.
--
-- Tabela nova, sem backfill: nao existe metodo tokenizado anterior a esta
-- fatia. Por isso um arquivo so, e nao os tres do padrao coluna-obrigatoria.

CREATE TYPE "payment_method_status" AS ENUM ('ACTIVE', 'EXPIRED', 'REMOVED');

CREATE TABLE "payment_methods" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "external_token_id" TEXT NOT NULL,
  "brand" TEXT,
  "last4" VARCHAR(4),
  "exp_month" INTEGER,
  "exp_year" INTEGER,
  "status" "payment_method_status" NOT NULL DEFAULT 'ACTIVE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- O token e unico no provedor: reenviar o mesmo cartao devolve o mesmo token,
-- e sem esta chave o aluno acumularia metodos duplicados a cada tentativa de
-- cadastro interrompida.
CREATE UNIQUE INDEX "payment_methods_provider_external_token_id_key"
  ON "payment_methods" ("provider", "external_token_id");

CREATE INDEX "payment_methods_tenant_id_student_id_status_idx"
  ON "payment_methods" ("tenant_id", "student_id", "status");

-- UM metodo padrao por aluno, garantido no BANCO. Sem isto, "qual cartao
-- cobrar?" teria duas respostas e a escolha cairia na ordem de insercao --
-- o mesmo defeito que `provider_accounts.capability` veio consertar.
-- Parcial: metodo removido ou expirado nao disputa o posto de padrao.
CREATE UNIQUE INDEX "payment_methods_tenant_id_student_id_default_key"
  ON "payment_methods" ("tenant_id", "student_id")
  WHERE "is_default" AND "status" = 'ACTIVE';

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
