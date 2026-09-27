-- F81: team.read/team.update para os tenants que JA EXISTEM.
--
-- Mesmo defeito que a F80 corrigiu para si mesma: alterar
-- `PERMISSOES_DO_OWNER` (packages/database/src/permissoes.ts) so afeta
-- tenant NOVO (via seed/bootstrap-tenant) -- o `AuthGuard` le a permissao
-- do banco (roles -> role_permissions -> permissions), nunca da constante.
-- Sem esta migration, todo tenant ja em producao teria OWNER e MANAGER
-- recebendo 403 FORBIDDEN em /team, apesar do codigo estar correto.
--
-- IDEMPOTENTE nos tres niveis (ON CONFLICT em permission e role_permission),
-- e NAO toca em `user_roles`: ninguem muda de papel por causa desta
-- migration.

-- 1. O catalogo global de permissoes, que ainda nao tem os dois codigos novos.
INSERT INTO permissions (id, code)
VALUES
  (gen_random_uuid(), 'team.read'),
  (gen_random_uuid(), 'team.update')
ON CONFLICT (code) DO NOTHING;

-- 2. OWNER e MANAGER de todo tenant ganham as duas -- mesmo recorte de
--    `PERMISSOES_DO_OWNER`/`PERMISSOES_DO_MANAGER` em `permissoes.ts`
--    (MANAGER deriva do OWNER por subtracao, e nao subtrai team.*).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('team.read', 'team.update')
WHERE r.name IN ('OWNER', 'MANAGER')
ON CONFLICT (role_id, permission_id) DO NOTHING;
