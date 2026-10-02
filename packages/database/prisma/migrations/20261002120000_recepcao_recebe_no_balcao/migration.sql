-- Perfil RECEPCAO recebe no balcao, emite o recibo e ve o time
-- (decisao do PI, 02/10/2026).
--
-- A lista do perfil mora em `packages/database/src/permissoes.ts`
-- (`PERMISSOES_DA_RECEPCAO`), que o tenant NOVO ja le. Esta migration leva o
-- acrescimo aos tenants que JA EXISTEM -- a Arena Positiva recebia "Seu perfil
-- nao tem permissao para esta acao" ao registrar pagamento.
--
-- IDEMPOTENTE (ON CONFLICT) e so ACRESCENTA: nao tira permissao de ninguem e
-- nao toca em `user_roles`.

INSERT INTO permissions (id, code)
VALUES
  (gen_random_uuid(), 'billing.payment.manual'),
  (gen_random_uuid(), 'receipt.issue'),
  (gen_random_uuid(), 'team.read')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('billing.payment.manual', 'receipt.issue', 'team.read')
WHERE r.name = 'RECEPTION' AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
