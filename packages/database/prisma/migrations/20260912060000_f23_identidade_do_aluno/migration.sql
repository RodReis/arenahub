-- CreateEnum
CREATE TYPE "StudentAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "StudentAccountTokenPurpose" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "StudentAccountTokenStatus" AS ENUM ('PENDING', 'CONSUMED', 'REVOKED');

-- CreateEnum
CREATE TYPE "StudentSessionStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateTable
CREATE TABLE "student_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "StudentAccountStatus" NOT NULL DEFAULT 'PENDING',
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_account_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" "StudentAccountTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "StudentAccountTokenStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "status" "StudentSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_label" TEXT,
    "reauthenticated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_accounts_student_id_key" ON "student_accounts"("student_id");

-- CreateIndex
CREATE INDEX "student_accounts_tenant_id_idx" ON "student_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_accounts_tenant_id_identifier_key" ON "student_accounts"("tenant_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "student_account_tokens_token_hash_key" ON "student_account_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "student_account_tokens_tenant_id_account_id_purpose_idx" ON "student_account_tokens"("tenant_id", "account_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "student_sessions_token_hash_key" ON "student_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "student_sessions_tenant_id_account_id_idx" ON "student_sessions"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "student_sessions_family_id_idx" ON "student_sessions"("family_id");

-- AddForeignKey
ALTER TABLE "student_accounts" ADD CONSTRAINT "student_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_accounts" ADD CONSTRAINT "student_accounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_account_tokens" ADD CONSTRAINT "student_account_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_account_tokens" ADD CONSTRAINT "student_account_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "student_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "student_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
