-- CreateTable
CREATE TABLE "device_reader_numbers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_reader_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_reader_numbers_tenant_id_device_id_idx" ON "device_reader_numbers"("tenant_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_reader_numbers_device_id_external_user_id_key" ON "device_reader_numbers"("device_id", "external_user_id");

-- AddForeignKey
ALTER TABLE "device_reader_numbers" ADD CONSTRAINT "device_reader_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_reader_numbers" ADD CONSTRAINT "device_reader_numbers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
