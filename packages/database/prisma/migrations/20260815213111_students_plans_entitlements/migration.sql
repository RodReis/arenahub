-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('LEAD', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "student_contact_type" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "entitlement_status" AS ENUM ('SCHEDULED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "entitlement_source" AS ENUM ('SUBSCRIPTION', 'COURTESY', 'EMPLOYEE', 'PERSONAL_TRAINER', 'VISITOR', 'TRIAL_CLASS', 'DEPENDENT', 'PARTNER', 'CORPORATE');

-- CreateEnum
CREATE TYPE "student_timeline_event_type" AS ENUM ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_STATUS_CHANGED', 'STUDENT_ARCHIVED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_PAUSED', 'SUBSCRIPTION_RESUMED', 'SUBSCRIPTION_CANCELLED', 'ENTITLEMENT_ACTIVATED', 'ENTITLEMENT_SUSPENDED', 'ENTITLEMENT_REVOKED', 'ENTITLEMENT_EXPIRED', 'COURTESY_GRANTED');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "cpf_hash" TEXT,
    "cpf_last3" TEXT,
    "status" "student_status" NOT NULL DEFAULT 'LEAD',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "student_contact_type" NOT NULL,
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "postal_code" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_sequences" (
    "tenant_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "student_timeline_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "student_timeline_event_type" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sales_start_at" TIMESTAMP(3),
    "sales_end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_units" (
    "plan_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,

    CONSTRAINT "plan_units_pkey" PRIMARY KEY ("plan_id","gym_unit_id")
);

-- CreateTable
CREATE TABLE "plan_access_windows" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "plan_access_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'PENDING',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "last_actor_id" UUID,
    "last_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "source" "entitlement_source" NOT NULL,
    "subscription_id" UUID,
    "status" "entitlement_status" NOT NULL DEFAULT 'SCHEDULED',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "granted_by_id" UUID,
    "reason" TEXT,
    "policy_snapshot" JSONB NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_unit_windows" (
    "id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "entitlement_unit_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "students_tenant_id_status_idx" ON "students"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "students_tenant_id_cpf_hash_idx" ON "students"("tenant_id", "cpf_hash");

-- CreateIndex
CREATE INDEX "students_tenant_id_full_name_idx" ON "students"("tenant_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_membership_number_key" ON "students"("tenant_id", "membership_number");

-- CreateIndex
CREATE INDEX "student_contacts_tenant_id_type_value_idx" ON "student_contacts"("tenant_id", "type", "value");

-- CreateIndex
CREATE INDEX "student_contacts_student_id_idx" ON "student_contacts"("student_id");

-- CreateIndex
CREATE INDEX "student_addresses_student_id_idx" ON "student_addresses"("student_id");

-- CreateIndex
CREATE INDEX "student_timeline_events_tenant_id_student_id_occurred_at_id_idx" ON "student_timeline_events"("tenant_id", "student_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "plans_tenant_id_is_active_idx" ON "plans"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "plan_access_windows_plan_id_gym_unit_id_day_of_week_idx" ON "plan_access_windows"("plan_id", "gym_unit_id", "day_of_week");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_student_id_status_idx" ON "subscriptions"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE INDEX "entitlements_tenant_id_student_id_status_starts_at_ends_at_idx" ON "entitlements"("tenant_id", "student_id", "status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "entitlement_unit_windows_entitlement_id_gym_unit_id_day_of__idx" ON "entitlement_unit_windows"("entitlement_id", "gym_unit_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_contacts" ADD CONSTRAINT "student_contacts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_addresses" ADD CONSTRAINT "student_addresses_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_sequences" ADD CONSTRAINT "student_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_timeline_events" ADD CONSTRAINT "student_timeline_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_units" ADD CONSTRAINT "plan_units_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_access_windows" ADD CONSTRAINT "plan_access_windows_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_unit_windows" ADD CONSTRAINT "entitlement_unit_windows_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
