-- CreateTable
CREATE TABLE "edge_pairing_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "gym_unit_id" UUID NOT NULL,
    "edge_node_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edge_pairing_codes_tenant_id_gym_unit_id_idx" ON "edge_pairing_codes"("tenant_id", "gym_unit_id");

-- AddForeignKey
ALTER TABLE "edge_pairing_codes" ADD CONSTRAINT "edge_pairing_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_pairing_codes" ADD CONSTRAINT "edge_pairing_codes_edge_node_id_fkey" FOREIGN KEY ("edge_node_id") REFERENCES "edge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

