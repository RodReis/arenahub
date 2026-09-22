-- F80: os quatro perfis prontos para os tenants que JA EXISTEM.
--
-- Gerado por `prisma/gerar-backfill-f80.ts` a partir de
-- `PAPEIS_DE_SISTEMA` -- nao editar a mao: rode o script de novo.
--
-- IDEMPOTENTE nos tres niveis (ON CONFLICT em role, permission e
-- role_permission) e NAO toca em `user_roles`: ninguem muda de perfil por
-- causa de uma migration. Quem e OWNER continua OWNER.

-- 1. O catalogo global de permissoes, que pode nao ter algum codigo ainda.
INSERT INTO permissions (id, code)
VALUES
  (gen_random_uuid(), 'access.override'),
  (gen_random_uuid(), 'access.read'),
  (gen_random_uuid(), 'billing.dashboard'),
  (gen_random_uuid(), 'billing.manage'),
  (gen_random_uuid(), 'billing.override.financial'),
  (gen_random_uuid(), 'billing.payment.manual'),
  (gen_random_uuid(), 'billing.read'),
  (gen_random_uuid(), 'billing.refund'),
  (gen_random_uuid(), 'biometric.enroll'),
  (gen_random_uuid(), 'biometric.read'),
  (gen_random_uuid(), 'biometric.revoke'),
  (gen_random_uuid(), 'class.manage'),
  (gen_random_uuid(), 'class.read'),
  (gen_random_uuid(), 'consent.manage'),
  (gen_random_uuid(), 'consent.read'),
  (gen_random_uuid(), 'device.manage'),
  (gen_random_uuid(), 'device.read'),
  (gen_random_uuid(), 'engagement.correct'),
  (gen_random_uuid(), 'engagement.moderate'),
  (gen_random_uuid(), 'engagement.read'),
  (gen_random_uuid(), 'health.assess'),
  (gen_random_uuid(), 'health.read'),
  (gen_random_uuid(), 'health.upload'),
  (gen_random_uuid(), 'plan.manage'),
  (gen_random_uuid(), 'plan.read'),
  (gen_random_uuid(), 'receipt.issue'),
  (gen_random_uuid(), 'receipt.read'),
  (gen_random_uuid(), 'reconciliation.read'),
  (gen_random_uuid(), 'reconciliation.resolve'),
  (gen_random_uuid(), 'retention.kill_switch'),
  (gen_random_uuid(), 'retention.read'),
  (gen_random_uuid(), 'retention.suppress'),
  (gen_random_uuid(), 'retention.task.manage'),
  (gen_random_uuid(), 'role.assign'),
  (gen_random_uuid(), 'student.create'),
  (gen_random_uuid(), 'student.read'),
  (gen_random_uuid(), 'student.update'),
  (gen_random_uuid(), 'subscription.manage'),
  (gen_random_uuid(), 'tenant.read'),
  (gen_random_uuid(), 'tenant.update'),
  (gen_random_uuid(), 'unit.create'),
  (gen_random_uuid(), 'unit.read'),
  (gen_random_uuid(), 'unit.update'),
  (gen_random_uuid(), 'user.manage')
ON CONFLICT (code) DO NOTHING;

-- 2.MANAGER: um papel por tenant.
INSERT INTO roles (id, tenant_id, name, is_system, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'MANAGER', true, now(), now() FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3.MANAGER: as permissoes do papel, em todo tenant.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.read',
  'tenant.update',
  'unit.create',
  'unit.read',
  'unit.update',
  'student.create',
  'student.read',
  'student.update',
  'plan.manage',
  'plan.read',
  'subscription.manage',
  'consent.manage',
  'consent.read',
  'biometric.enroll',
  'biometric.read',
  'biometric.revoke',
  'device.manage',
  'device.read',
  'engagement.read',
  'engagement.moderate',
  'engagement.correct',
  'access.read',
  'access.override',
  'billing.read',
  'billing.manage',
  'billing.payment.manual',
  'billing.override.financial',
  'billing.refund',
  'reconciliation.read',
  'reconciliation.resolve',
  'receipt.read',
  'receipt.issue',
  'health.read',
  'health.assess',
  'health.upload',
  'billing.dashboard',
  'retention.read',
  'retention.suppress',
  'retention.task.manage',
  'class.manage',
  'class.read'
)
WHERE r.name = 'MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 2.FINANCE: um papel por tenant.
INSERT INTO roles (id, tenant_id, name, is_system, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'FINANCE', true, now(), now() FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3.FINANCE: as permissoes do papel, em todo tenant.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.read',
  'unit.read',
  'student.read',
  'plan.manage',
  'plan.read',
  'subscription.manage',
  'billing.manage',
  'billing.read',
  'billing.refund',
  'billing.dashboard',
  'receipt.issue',
  'receipt.read',
  'reconciliation.read',
  'reconciliation.resolve'
)
WHERE r.name = 'FINANCE'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 2.RECEPTION: um papel por tenant.
INSERT INTO roles (id, tenant_id, name, is_system, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'RECEPTION', true, now(), now() FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3.RECEPTION: as permissoes do papel, em todo tenant.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.read',
  'unit.read',
  'student.create',
  'student.read',
  'student.update',
  'plan.read',
  'billing.read',
  'receipt.read',
  'consent.manage',
  'consent.read',
  'biometric.enroll',
  'device.read',
  'access.read',
  'class.read',
  'health.upload',
  'engagement.read'
)
WHERE r.name = 'RECEPTION'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 2.TRAINER: um papel por tenant.
INSERT INTO roles (id, tenant_id, name, is_system, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'TRAINER', true, now(), now() FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3.TRAINER: as permissoes do papel, em todo tenant.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.read',
  'unit.read',
  'student.read',
  'class.manage',
  'class.read',
  'health.read',
  'health.assess',
  'engagement.read'
)
WHERE r.name = 'TRAINER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
