-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('DINHEIRO', 'PIX', 'DEBITO', 'CREDITO');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "received_via" "PaymentChannel";
