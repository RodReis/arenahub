-- AlterTable
ALTER TABLE "billing_settings" ALTER COLUMN "grace_days" SET DEFAULT 5;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "coverage_ends_at" TIMESTAMP(3);
