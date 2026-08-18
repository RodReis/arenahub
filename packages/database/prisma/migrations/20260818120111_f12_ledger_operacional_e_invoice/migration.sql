-- CreateEnum
CREATE TYPE "PlanBenefitStatus" AS ENUM ('INCLUDED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "FamilyMemberRole" AS ENUM ('HOLDER', 'DEPENDENT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('MANUAL', 'PIX', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccountCreditStatus" AS ENUM ('AVAILABLE', 'APPLIED', 'EXPIRED');

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "valid_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_benefits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "status" "PlanBenefitStatus" NOT NULL DEFAULT 'INCLUDED',
    "every_days" INTEGER,
    "detail" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plan_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "member_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "role" "FamilyMemberRole" NOT NULL DEFAULT 'DEPENDENT',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "tenant_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "due_day" INTEGER NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "billing_period" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "number" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "subtotal_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "block_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "method" "PaymentMethodKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "recognized_by_user_id" UUID,
    "attempt_id" UUID,
    "provider_account_id" TEXT,
    "external_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "method" "PaymentMethodKind" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "idempotency_key" TEXT NOT NULL,
    "provider_account_id" TEXT,
    "external_payment_id" TEXT,
    "failure_code" TEXT,
    "failure_is_permanent" BOOLEAN,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_credits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "origin_payment_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "AccountCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "applied_to_invoice_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_prices_tenant_id_plan_id_valid_from_idx" ON "plan_prices"("tenant_id", "plan_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_valid_from_key" ON "plan_prices"("plan_id", "valid_from");

-- CreateIndex
CREATE INDEX "plan_benefits_tenant_id_plan_id_position_idx" ON "plan_benefits"("tenant_id", "plan_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "family_groups_subscription_id_key" ON "family_groups"("subscription_id");

-- CreateIndex
CREATE INDEX "family_groups_tenant_id_idx" ON "family_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "family_members_tenant_id_student_id_idx" ON "family_members"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_group_id_student_id_key" ON "family_members"("group_id", "student_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_due_at_idx" ON "invoices"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_subscription_id_billing_period_key" ON "invoices"("tenant_id", "subscription_id", "billing_period");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "invoice_items_tenant_id_invoice_id_idx" ON "invoice_items"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_attempt_id_key" ON "payments"("attempt_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_status_idx" ON "payments"("tenant_id", "invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_account_id_external_payment_id_key" ON "payments"("provider_account_id", "external_payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_tenant_id_invoice_id_status_idx" ON "payment_attempts"("tenant_id", "invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_tenant_id_idempotency_key_key" ON "payment_attempts"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "account_credits_tenant_id_student_id_status_idx" ON "account_credits"("tenant_id", "student_id", "status");

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_benefits" ADD CONSTRAINT "plan_benefits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_benefits" ADD CONSTRAINT "plan_benefits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_groups" ADD CONSTRAINT "family_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_groups" ADD CONSTRAINT "family_groups_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_origin_payment_id_fkey" FOREIGN KEY ("origin_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
