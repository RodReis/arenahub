-- Link curto do app e mensagem para o aluno (issue #538).

-- Sem RLS de proposito: a pagina publica resolve o slug antes de saber a
-- academia. Guarda so slug -> tenant; o destino (APK) segue sob RLS.
CREATE TABLE "app_short_links" (
    "slug" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_short_links_pkey" PRIMARY KEY ("slug")
);

CREATE UNIQUE INDEX "app_short_links_tenant_id_key" ON "app_short_links"("tenant_id");

ALTER TABLE "app_short_links"
  ADD CONSTRAINT "app_short_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_app_distribution" ADD COLUMN "message_template" TEXT;
