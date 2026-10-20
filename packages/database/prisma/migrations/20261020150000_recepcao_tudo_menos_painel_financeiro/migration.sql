-- Perfil RECEPCAO passa a ter TUDO o que o dono tem, menos o painel financeiro
-- (`billing.dashboard`) -- decisao do PI, 20/10/2026.
--
-- A lista do perfil mora em `packages/database/src/permissoes.ts`
-- (`PERMISSOES_DA_RECEPCAO`, derivada do OWNER por subtracao), que o tenant NOVO
-- ja le. Esta migration leva o acrescimo aos tenants que JA EXISTEM (a Arena
-- Positiva): sao as 26 permissoes que a recepcao ainda nao tinha.
--
-- IDEMPOTENTE (ON CONFLICT) e so ACRESCENTA: nao tira permissao de ninguem, nao
-- toca em `user_roles` e nao concede `billing.dashboard`.

INSERT INTO permissions (id, code)
SELECT gen_random_uuid(), c
FROM unnest(ARRAY[
  'tenant.update', 'unit.create', 'unit.update', 'user.manage', 'role.assign',
  'plan.manage', 'biometric.read', 'biometric.revoke', 'device.manage',
  'engagement.moderate', 'engagement.correct', 'access.override',
  'billing.manage', 'billing.settings.manage', 'billing.override.financial',
  'billing.refund', 'reconciliation.read', 'reconciliation.resolve',
  'health.read', 'health.assess', 'retention.read', 'retention.suppress',
  'retention.task.manage', 'retention.kill_switch', 'class.manage', 'team.update'
]) AS c
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.update', 'unit.create', 'unit.update', 'user.manage', 'role.assign',
  'plan.manage', 'biometric.read', 'biometric.revoke', 'device.manage',
  'engagement.moderate', 'engagement.correct', 'access.override',
  'billing.manage', 'billing.settings.manage', 'billing.override.financial',
  'billing.refund', 'reconciliation.read', 'reconciliation.resolve',
  'health.read', 'health.assess', 'retention.read', 'retention.suppress',
  'retention.task.manage', 'retention.kill_switch', 'class.manage', 'team.update'
)
WHERE r.name = 'RECEPTION' AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
