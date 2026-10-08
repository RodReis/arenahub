-- F89: configuracao de pagamento por tenant.
--
-- `invoice_generation_day` nasce com DEFAULT 1: toda linha existente fica com o
-- comportamento do cron atual (dia 01). Producao ja tem due_day = 10 e
-- grace_days = 5.
ALTER TABLE "billing_settings"
  ADD COLUMN "invoice_generation_day" INTEGER NOT NULL DEFAULT 1;

-- `grace_days` aceita 0 no banco (existe tenant de teste sem carencia); o
-- minimo de 1 e regra de ENTRADA da API.
ALTER TABLE "billing_settings"
  ADD CONSTRAINT "billing_settings_invoice_generation_day_check"
    CHECK ("invoice_generation_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "billing_settings_due_day_check"
    CHECK ("due_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "billing_settings_grace_days_check"
    CHECK ("grace_days" BETWEEN 0 AND 30),
  ADD CONSTRAINT "billing_settings_generation_before_due_check"
    CHECK ("invoice_generation_day" <= "due_day");

INSERT INTO permissions (id, code)
VALUES (gen_random_uuid(), 'billing.settings.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'billing.settings.manage'
WHERE r.name IN ('OWNER', 'MANAGER') AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
