-- CreateEnum
CREATE TYPE "student_profile" AS ENUM ('ADMIN', 'STUDENT', 'STAFF', 'TRAINER');

-- CreateEnum
CREATE TYPE "student_credential_kind" AS ENUM ('TURNSTILE_CARD', 'FACIAL_ENROLL_ID');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "profile" "student_profile" NOT NULL DEFAULT 'STUDENT';

-- CreateTable
CREATE TABLE "student_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" "student_credential_kind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_credentials_tenant_id_student_id_idx" ON "student_credentials"("tenant_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_credentials_tenant_id_kind_external_id_key" ON "student_credentials"("tenant_id", "kind", "external_id");

-- AddForeignKey
ALTER TABLE "student_credentials" ADD CONSTRAINT "student_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_credentials" ADD CONSTRAINT "student_credentials_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
