-- CreateEnum
CREATE TYPE "health_measurement_type" AS ENUM ('BLOOD_PRESSURE', 'OXYGEN_SATURATION', 'RESTING_HEART_RATE');

-- CreateTable
CREATE TABLE "health_measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "health_measurement_type" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "secondary_value" DECIMAL(10,4),
    "unit" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "source" "measurement_source" NOT NULL DEFAULT 'MANUAL',
    "source_reference" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "device_report" JSONB,
    "device_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_measurements_tenant_id_student_id_type_measured_at_idx" ON "health_measurements"("tenant_id", "student_id", "type", "measured_at");

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
