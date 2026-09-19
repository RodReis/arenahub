-- CreateEnum
CREATE TYPE "class_reservation_status" AS ENUM ('RESERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'NO_SHOW');

-- CreateTable
CREATE TABLE "plan_class_entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "modality_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_class_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "status" "class_reservation_status" NOT NULL DEFAULT 'RESERVED',
    "overridden_by_id" UUID,
    "overridden_at" TIMESTAMP(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_attendances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "marked_by_id" UUID NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_class_entitlements_tenant_id_plan_id_idx" ON "plan_class_entitlements"("tenant_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_class_entitlements_plan_id_modality_id_key" ON "plan_class_entitlements"("plan_id", "modality_id");

-- CreateIndex
CREATE INDEX "class_reservations_tenant_id_class_id_occurrence_date_idx" ON "class_reservations"("tenant_id", "class_id", "occurrence_date");

-- CreateIndex
CREATE UNIQUE INDEX "class_reservations_class_id_occurrence_date_student_id_key" ON "class_reservations"("class_id", "occurrence_date", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_attendances_reservation_id_key" ON "class_attendances"("reservation_id");

-- CreateIndex
CREATE INDEX "class_attendances_tenant_id_reservation_id_idx" ON "class_attendances"("tenant_id", "reservation_id");

-- AddForeignKey
ALTER TABLE "plan_class_entitlements" ADD CONSTRAINT "plan_class_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_class_entitlements" ADD CONSTRAINT "plan_class_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_class_entitlements" ADD CONSTRAINT "plan_class_entitlements_modality_id_fkey" FOREIGN KEY ("modality_id") REFERENCES "gym_unit_modalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_reservations" ADD CONSTRAINT "class_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_reservations" ADD CONSTRAINT "class_reservations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_reservations" ADD CONSTRAINT "class_reservations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_reservations" ADD CONSTRAINT "class_reservations_overridden_by_id_fkey" FOREIGN KEY ("overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_reservations" ADD CONSTRAINT "class_reservations_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendances" ADD CONSTRAINT "class_attendances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendances" ADD CONSTRAINT "class_attendances_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "class_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendances" ADD CONSTRAINT "class_attendances_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
