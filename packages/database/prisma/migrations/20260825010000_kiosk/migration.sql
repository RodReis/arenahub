-- CreateEnum
CREATE TYPE "KioskDeviceStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "kiosk_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "KioskDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "agent_version" TEXT,
    "last_heartbeat" TIMESTAMP(3),
    "clock_offset_ms" INTEGER,
    "boot_config_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kiosk_device_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "active_from" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_configurations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID,
    "kiosk_device_id" UUID,
    "version" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_replay_nonces" (
    "id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_replay_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kiosk_device_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "ended_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kiosk_devices_tenant_id_gym_unit_id_idx" ON "kiosk_devices"("tenant_id", "gym_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_devices_tenant_id_code_key" ON "kiosk_devices"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_credentials_key_id_key" ON "kiosk_credentials"("key_id");

-- CreateIndex
CREATE INDEX "kiosk_credentials_kiosk_device_id_idx" ON "kiosk_credentials"("kiosk_device_id");

-- CreateIndex
CREATE INDEX "kiosk_configurations_tenant_id_published_at_idx" ON "kiosk_configurations"("tenant_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_configurations_tenant_id_gym_unit_id_kiosk_device_id__key" ON "kiosk_configurations"("tenant_id", "gym_unit_id", "kiosk_device_id", "version");

-- CreateIndex
CREATE INDEX "kiosk_replay_nonces_expires_at_idx" ON "kiosk_replay_nonces"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_replay_nonces_key_id_nonce_hash_key" ON "kiosk_replay_nonces"("key_id", "nonce_hash");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_sessions_token_hash_key" ON "kiosk_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "kiosk_sessions_kiosk_device_id_ended_at_idx" ON "kiosk_sessions"("kiosk_device_id", "ended_at");

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_credentials" ADD CONSTRAINT "kiosk_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_credentials" ADD CONSTRAINT "kiosk_credentials_kiosk_device_id_fkey" FOREIGN KEY ("kiosk_device_id") REFERENCES "kiosk_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_configurations" ADD CONSTRAINT "kiosk_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_kiosk_device_id_fkey" FOREIGN KEY ("kiosk_device_id") REFERENCES "kiosk_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
