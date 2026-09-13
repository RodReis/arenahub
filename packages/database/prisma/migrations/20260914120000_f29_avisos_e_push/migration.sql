-- CreateEnum
CREATE TYPE "student_notification_kind" AS ENUM ('BILLING', 'ASSESSMENT', 'MEMBERSHIP', 'GENERAL');

-- CreateEnum
CREATE TYPE "student_notification_action" AS ENUM ('NONE', 'OPEN_INVOICE', 'OPEN_ATTENDANCE', 'OPEN_HEALTH');

-- CreateEnum
CREATE TYPE "push_provider_kind" AS ENUM ('ONESIGNAL');

-- CreateEnum
CREATE TYPE "push_platform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "push_revocation_reason" AS ENUM ('CONSENT_REVOKED', 'TOKEN_REJECTED', 'SESSION_ENDED');

-- CreateTable
CREATE TABLE "student_notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" "student_notification_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action" "student_notification_action" NOT NULL DEFAULT 'NONE',
    "action_target_id" UUID,
    "read_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "provider" "push_provider_kind" NOT NULL,
    "platform" "push_platform" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_cipher" TEXT NOT NULL,
    "device_label" TEXT,
    "consent_version" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "push_revocation_reason",
    "last_delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_notifications_tenant_id_student_id_created_at_idx" ON "student_notifications"("tenant_id", "student_id", "created_at");

-- CreateIndex
CREATE INDEX "push_subscriptions_tenant_id_student_id_idx" ON "push_subscriptions"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_tenant_id_token_hash_key" ON "push_subscriptions"("tenant_id", "token_hash");

-- AddForeignKey
ALTER TABLE "student_notifications" ADD CONSTRAINT "student_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_notifications" ADD CONSTRAINT "student_notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
