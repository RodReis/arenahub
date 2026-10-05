-- Perfil RECEPCAO adiciona e altera o plano do aluno.
--
-- A lista do perfil mora em `packages/database/src/permissoes.ts`
-- (`PERMISSOES_DA_RECEPCAO`), que o tenant NOVO ja le. Esta migration leva o
-- acrescimo aos tenants que JA EXISTEM -- a recepcao recebia "Seu perfil nao
-- tem permissao para esta acao" ao criar ou trocar a assinatura do aluno.
--
-- IDEMPOTENTE (ON CONFLICT) e so ACRESCENTA: nao tira permissao de ninguem e
-- nao toca em `user_roles`.

INSERT INTO permissions (id, code)
VALUES (gen_random_uuid(), 'subscription.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'subscription.manage'
WHERE r.name = 'RECEPTION' AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
