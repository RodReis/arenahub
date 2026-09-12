-- CreateEnum
CREATE TYPE "contract_signature_status" AS ENUM ('PENDING', 'SIGNED', 'WAIVED');

-- AlterTable
ALTER TABLE "tenant_contracts" ADD COLUMN     "foro_cidade" TEXT,
ADD COLUMN     "foro_uf" TEXT,
ADD COLUMN     "signature_status" "contract_signature_status" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "signed_at" TIMESTAMP(3),
ADD COLUMN     "signed_document_object_key" TEXT,
ADD COLUMN     "terms_version" TEXT NOT NULL DEFAULT '2026.1';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address_city" TEXT,
ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "address_state" TEXT,
ADD COLUMN     "address_zip" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "responsavel_cpf" TEXT;
