-- CreateTable
CREATE TABLE "local_holidays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_holidays_tenant_id_gym_unit_id_date_idx" ON "local_holidays"("tenant_id", "gym_unit_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "local_holidays_gym_unit_id_date_key" ON "local_holidays"("gym_unit_id", "date");

-- AddForeignKey
ALTER TABLE "local_holidays" ADD CONSTRAINT "local_holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_holidays" ADD CONSTRAINT "local_holidays_gym_unit_id_fkey" FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
