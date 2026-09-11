-- F68: superficies contratadas (mobile e totem) no plano SaaS e no contrato.
--
-- `DEFAULT true` E NAO `false`, e isso e o ponto da migration: contrato ja
-- fechado nunca autorizou perder acesso. Nascer `false` desligaria o totem de
-- toda academia que contratou antes desta coluna existir -- com a catraca
-- parando no dia do deploy, sem ninguem ter negociado nada.
--
-- `NOT NULL` com default preenche as linhas existentes na propria alteracao.

ALTER TABLE "saas_plans"
  ADD COLUMN "mobile_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "kiosk_enabled"  BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "tenant_contracts"
  ADD COLUMN "mobile_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "kiosk_enabled"  BOOLEAN NOT NULL DEFAULT true;
