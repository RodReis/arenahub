-- Final antigo do link do app vira APELIDO permanente da mesma academia (#538,
-- achado da revisao): trocar o final nao pode liberar o antigo para outra
-- academia -- o QR ja impresso passaria a baixar o APK dela.

ALTER TABLE "app_short_links" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "app_short_links_tenant_id_key";
CREATE INDEX "app_short_links_tenant_id_idx" ON "app_short_links"("tenant_id");

-- Um final PRINCIPAL por academia (o que o painel mostra); os demais sao
-- apelidos que continuam resolvendo. Indice parcial: o Prisma nao o declara.
CREATE UNIQUE INDEX "app_short_links_principal_por_tenant"
  ON "app_short_links"("tenant_id")
  WHERE "is_primary";
