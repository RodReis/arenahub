-- Instalador Android da academia (issue #534).
CREATE TABLE "tenant_app_distribution" (
    "tenant_id" UUID NOT NULL,
    "android_url" TEXT NOT NULL,
    "android_version" TEXT,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_app_distribution_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_app_distribution"
  ADD CONSTRAINT "tenant_app_distribution_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesma politica da F66 (`students`): sem contexto de tenant a leitura devolve
-- zero linhas e a escrita falha (42501). Os GRANTs ao role `arenahub_app` vem
-- do `ALTER DEFAULT PRIVILEGES` da F66.
ALTER TABLE tenant_app_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_app_distribution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_app_distribution ON tenant_app_distribution
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  );
