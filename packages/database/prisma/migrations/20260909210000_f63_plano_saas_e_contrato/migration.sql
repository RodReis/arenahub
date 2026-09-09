-- F63 -- Plano SaaS e contrato do tenant (ADR-052 §5-§8).
--
-- Tres tabelas do MVP 7 (Plataforma): o ArenaHub cobrando a academia. Nenhuma
-- delas e escopo de tenant no sentido do modulo `billing` -- `saas_plans` e
-- `index_values` sao catalogo global do dono do SaaS, e `tenant_contracts`
-- referencia o tenant como ALVO da cobranca.
--
-- Nao toca em nenhuma tabela existente: as tres nascem vazias, e o unico
-- vinculo com o que ja existe e a FK para `tenants`.

-- CreateEnum
CREATE TYPE "saas_pricing_model" AS ENUM ('PER_STUDENT', 'FIXED_MONTHLY');

-- CreateEnum
CREATE TYPE "saas_plan_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tenant_contract_status" AS ENUM ('DRAFT', 'ACTIVE', 'TERMINATED');

-- CreateTable
CREATE TABLE "saas_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "model" "saas_pricing_model" NOT NULL,
    "active_student_price_minor" INTEGER,
    "inactive_student_price_minor" INTEGER,
    "fixed_price_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "saas_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "model" "saas_pricing_model" NOT NULL,
    "active_student_price_minor" INTEGER,
    "inactive_student_price_minor" INTEGER,
    "fixed_price_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "index_code" TEXT NOT NULL DEFAULT 'IPCA',
    "base_date" DATE NOT NULL,
    "anniversary_day" INTEGER NOT NULL,
    "anniversary_month" INTEGER NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 15,
    "issue_day" INTEGER NOT NULL,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE,
    "status" "tenant_contract_status" NOT NULL DEFAULT 'DRAFT',
    "supersedes_id" UUID,
    "document_object_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_values" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "reference_month" DATE NOT NULL,
    "variation_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_plans_status_idx" ON "saas_plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_contracts_supersedes_id_key" ON "tenant_contracts"("supersedes_id");

-- CreateIndex
CREATE INDEX "tenant_contracts_tenant_id_status_idx" ON "tenant_contracts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "index_values_code_reference_month_idx" ON "index_values"("code", "reference_month");

-- CreateIndex
CREATE UNIQUE INDEX "index_values_code_reference_month_key" ON "index_values"("code", "reference_month");

-- AddForeignKey
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "tenant_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- GUARDAS NO BANCO, e nao `if` na aplicacao.
--
-- Sao invariantes de dinheiro e de vigencia: um `if` no caso de uso protege o
-- caminho que passa por ele, e o import, o seed e o `psql` de madrugada
-- entram por fora. A regra 6 (dinheiro inteiro) so vale se o banco recusar o
-- valor impossivel.
-- ---------------------------------------------------------------------------

-- O modelo do plano decide QUAIS valores existem. Plano por aluno sem preco
-- de ativo faturaria zero e ninguem notaria ate a primeira fatura; plano fixo
-- com preco por aluno guarda dois precos e deixa a proxima leitura escolher.
ALTER TABLE "saas_plans" ADD CONSTRAINT "saas_plans_valores_por_modelo" CHECK (
  (
    "model" = 'PER_STUDENT'
    AND "active_student_price_minor" IS NOT NULL
    AND "inactive_student_price_minor" IS NOT NULL
    AND "fixed_price_minor" IS NULL
  ) OR (
    "model" = 'FIXED_MONTHLY'
    AND "fixed_price_minor" IS NOT NULL
    AND "active_student_price_minor" IS NULL
    AND "inactive_student_price_minor" IS NULL
  )
);

-- Preco negativo e credito disfarcado de cobranca. ZERO E PERMITIDO, e de
-- proposito: o preco do inativo e negociado por contrato e pode ser zero
-- (ADR-052 §6).
ALTER TABLE "saas_plans" ADD CONSTRAINT "saas_plans_precos_nao_negativos" CHECK (
  COALESCE("active_student_price_minor", 0) >= 0
  AND COALESCE("inactive_student_price_minor", 0) >= 0
  AND COALESCE("fixed_price_minor", 0) >= 0
);

-- A mesma regra de coerencia, na COPIA. O contrato nao herda o CHECK do plano
-- por ser outra tabela, e e ele que a fatura le.
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_valores_por_modelo" CHECK (
  (
    "model" = 'PER_STUDENT'
    AND "active_student_price_minor" IS NOT NULL
    AND "inactive_student_price_minor" IS NOT NULL
    AND "fixed_price_minor" IS NULL
  ) OR (
    "model" = 'FIXED_MONTHLY'
    AND "fixed_price_minor" IS NOT NULL
    AND "active_student_price_minor" IS NULL
    AND "inactive_student_price_minor" IS NULL
  )
);

ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_precos_nao_negativos" CHECK (
  COALESCE("active_student_price_minor", 0) >= 0
  AND COALESCE("inactive_student_price_minor", 0) >= 0
  AND COALESCE("fixed_price_minor", 0) >= 0
);

-- `issue_day` para em 28 pela mesma razao de `billing_settings.due_day`:
-- existir em fevereiro sem regra de excecao. O aniversario aceita 1-31 porque
-- e data-base de contrato, nao dia de emissao -- 31/01 e aniversario legitimo.
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_dias_validos" CHECK (
  "issue_day" BETWEEN 1 AND 28
  AND "anniversary_day" BETWEEN 1 AND 31
  AND "anniversary_month" BETWEEN 1 AND 12
  AND "grace_days" >= 0
);

-- Vigencia que termina antes de comecar e contrato que nunca vale.
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_vigencia_coerente" CHECK (
  "ends_at" IS NULL OR "ends_at" >= "starts_at"
);

-- UM CONTRATO VIGENTE POR ACADEMIA.
--
-- Indice PARCIAL sobre `tenant_id`, e nao `UNIQUE` sobre (tenant, status):
-- este seria satisfeito por dois `DRAFT`, que sao legitimos, e recusaria o
-- segundo `TERMINATED`, que e historico e tem de caber. So `ACTIVE` e
-- exclusivo.
--
-- E indice, e nao `if` no caso de uso: duas requisicoes simultaneas de
-- ativacao passam pelas duas leituras antes de qualquer escrita, e ambas
-- gravam. Exclusao mutua mora no banco.
CREATE UNIQUE INDEX "tenant_contracts_um_ativo_por_tenant"
  ON "tenant_contracts" ("tenant_id")
  WHERE "status" = 'ACTIVE';

-- Contrato ativo sem PDF e contrato sem documento -- o PDF nasce no
-- fechamento (ADR-052 §8). `DRAFT` fica sem, de proposito: documento de
-- rascunho circulando como contrato e pior que documento nenhum.
ALTER TABLE "tenant_contracts" ADD CONSTRAINT "tenant_contracts_ativo_tem_documento" CHECK (
  "status" = 'DRAFT' OR "document_object_key" IS NOT NULL
);

-- Competencia e o PRIMEIRO DIA DO MES. Gravar 15/03 e 01/03 criaria duas
-- linhas para marco, e a chave unica (code, reference_month) nao as veria
-- como a mesma competencia.
ALTER TABLE "index_values" ADD CONSTRAINT "index_values_competencia_e_primeiro_dia" CHECK (
  EXTRACT(DAY FROM "reference_month") = 1
);
