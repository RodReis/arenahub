-- F64 -- Fatura da plataforma sobre o tenant (ADR-052, Fatura da plataforma).
--
-- Uma tabela nova, e NENHUMA existente e tocada. Nao reaproveita `invoices`:
-- aquela e do tenant cobrando o aluno, esta e do ArenaHub cobrando o tenant --
-- outro pagador, outro ciclo, e vencida ela fecha a catraca inteira (F65).
--
-- A contagem de alunos e CONGELADA em colunas, e nao consultada na leitura:
-- o aluno que muda de status depois da emissao nao reescreve fatura ja
-- emitida. E o aceite da fatia.

-- CreateEnum
CREATE TYPE "platform_invoice_status" AS ENUM ('OPEN', 'PAID', 'OVERDUE');

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "competence" DATE NOT NULL,
    "model" "saas_pricing_model" NOT NULL,
    "active_count" INTEGER NOT NULL DEFAULT 0,
    "inactive_count" INTEGER NOT NULL DEFAULT 0,
    "active_student_price_minor" INTEGER,
    "inactive_student_price_minor" INTEGER,
    "total_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "due_at" DATE NOT NULL,
    "status" "platform_invoice_status" NOT NULL DEFAULT 'OPEN',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_status_idx" ON "platform_invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_at_idx" ON "platform_invoices"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_tenant_id_competence_key" ON "platform_invoices"("tenant_id", "competence");

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "tenant_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- GUARDAS NO BANCO, e nao `if` no caso de uso -- mesma razao da F63: o job
-- protege o caminho que passa por ele, e o seed, o import e o `psql` de
-- madrugada entram por fora. Dinheiro so e inteiro de verdade se o banco
-- recusar o valor impossivel.
-- ---------------------------------------------------------------------------

-- Competencia e o PRIMEIRO DIA DO MES. Sem isto, emitir dia 1 e depois dia 15
-- da mesma competencia criaria duas linhas que a chave unica (tenant,
-- competencia) nao veria como o mesmo mes -- e a idempotencia (regra 4)
-- deixaria de existir sem que nada falhasse.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_competencia_e_primeiro_dia" CHECK (
  EXTRACT(DAY FROM "competence") = 1
);

-- Contagem e dinheiro nao sao negativos. ZERO E LEGITIMO nos dois: academia
-- sem aluno inativo, e preco de inativo zerado por negociacao (ADR-052 §6)
-- produzem fatura de valor menor, nao fatura invalida.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_valores_nao_negativos" CHECK (
  "active_count" >= 0
  AND "inactive_count" >= 0
  AND "total_minor" >= 0
  AND COALESCE("active_student_price_minor", 0) >= 0
  AND COALESCE("inactive_student_price_minor", 0) >= 0
);

-- O modelo decide QUAIS colunas existem, espelhando o CHECK do contrato.
-- Fatura por aluno sem preco unitario nao prova como chegou ao total; fatura
-- fixa com contagem guardaria um numero que ninguem usou para cobrar e que a
-- proxima leitura poderia tomar por base.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_campos_por_modelo" CHECK (
  (
    "model" = 'PER_STUDENT'
    AND "active_student_price_minor" IS NOT NULL
    AND "inactive_student_price_minor" IS NOT NULL
  ) OR (
    "model" = 'FIXED_MONTHLY'
    AND "active_student_price_minor" IS NULL
    AND "inactive_student_price_minor" IS NULL
    AND "active_count" = 0
    AND "inactive_count" = 0
  )
);

-- `paid_at` e o status andam juntos. Sem isto, registrar o pagamento gravando
-- so uma das duas colunas produz uma fatura paga sem data (o historico perde
-- o quando) ou uma fatura com data de pagamento que continua cobrando -- e a
-- carencia da F65 le o status.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_pagamento_coerente" CHECK (
  ("status" = 'PAID' AND "paid_at" IS NOT NULL)
  OR ("status" <> 'PAID' AND "paid_at" IS NULL)
);

-- Vencimento nunca antes da competencia que ele cobra.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_vencimento_coerente" CHECK (
  "due_at" >= "competence"
);
