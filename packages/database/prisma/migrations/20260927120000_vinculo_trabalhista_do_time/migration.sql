-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('CLT', 'PJ', 'AUTONOMOUS');

-- AlterTable
ALTER TABLE "students" ADD COLUMN "employment_type" "employment_type",
ADD COLUMN "employment_started_at" date;
