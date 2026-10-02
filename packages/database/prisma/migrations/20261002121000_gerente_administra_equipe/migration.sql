-- Perfil GERENTE administra a equipe: convida, revoga e troca perfil
-- (decisao do PI, 02/10/2026).
--
-- A lista do perfil deriva do OWNER em `packages/database/src/permissoes.ts`
-- (`NEGADAS_AO_MANAGER` agora so tem `retention.kill_switch`), que o tenant
-- NOVO ja le. Esta migration leva o acrescimo aos tenants que JA EXISTEM.
--
-- IDEMPOTENTE (ON CONFLICT) e so ACRESCENTA: nao tira permissao de ninguem e
-- nao toca em `user_roles`.

INSERT INTO permissions (id, code)
VALUES
  (gen_random_uuid(), 'user.manage'),
  (gen_random_uuid(), 'role.assign')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('user.manage', 'role.assign')
WHERE r.name = 'MANAGER' AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
