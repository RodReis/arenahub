-- F66 (SPEC-066, ADR-054 SS1-4, SS6): role de runtime separado do dono das
-- tabelas, e primeiras politicas RLS em students e audit_logs.
--
-- RLS e SEGUNDA CAMADA. TenantContext continua obrigatorio na aplicacao
-- (INV-003) -- esta migration nao dispensa nenhum `where` de repositorio.
-- Ela garante que a query que esquecer o `where` nao ve nada, e que a
-- escrita cruzada falha.

-- 1. Role de runtime.
--
-- NOBYPASSRLS e explicito de proposito: e o ponto central do ADR-054 SS2 --
-- sem ele a politica simplesmente nao se aplica a este role, e tudo abaixo
-- vira decoracao. Senha NAO entra aqui (credencial nao se versiona, nem em
-- dev) -- ver docs/DEVELOPMENT.md, secao "Role de runtime (RLS)".
--
-- IF NOT EXISTS porque role e objeto de CLUSTER, nao de banco: com
-- arenahub, arenahub_int e arenahub_e2e no mesmo cluster, esta migration
-- roda tres vezes e as duas ultimas encontrariam o role ja criado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arenahub_app') THEN
    CREATE ROLE arenahub_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2. Permissao de DADO, nao de ESTRUTURA. O role le e escreve nas duas
-- tabelas desta fase, mas nao e dono: nao pode DROP, ALTER, nem criar ou
-- derrubar politica. Quem roda esta migration continua sendo o owner.
GRANT USAGE ON SCHEMA public TO arenahub_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON students TO arenahub_app;

-- audit_logs sem UPDATE e sem DELETE: trilha de auditoria que a aplicacao
-- pode editar nao e trilha de auditoria. Escreve e le, so.
GRANT SELECT, INSERT ON audit_logs TO arenahub_app;

-- 3. FORCE, e nao apenas ENABLE.
--
-- Sem FORCE o dono da tabela fica ISENTO da politica -- e o padrao do
-- Postgres. Com FORCE, o dono passa a obedece-la como qualquer outro role.
--
-- ATENCAO ao limite disso: SUPERUSUARIO ignora RLS sempre, FORCE ou nao.
-- Verificado em 10/09/2026 -- o `arenahub` do docker-compose local e
-- superusuario e enxerga as 1984 linhas sem contexto nenhum. Em
-- desenvolvimento isso e ate conveniente (o seed roda sem mudanca), mas
-- significa que a protecao real vem de a aplicacao usar
-- RUNTIME_DATABASE_URL, nao de FORCE sozinho. Em producao o role de
-- migracao NAO deve ser superusuario -- e a diferenca entre a politica
-- valer e ela ser decoracao.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- 4. Politicas.
--
-- `current_setting('app.tenant_id', true)` -- o segundo argumento e
-- missing_ok -- devolve NULL quando a GUC nunca foi setada, em vez de
-- lancar. NULL comparado a qualquer coisa e falso, entao a transacao SEM
-- contexto le zero linhas e a escrita sem contexto estoura 42501.
--
-- Verificado contra Postgres 17 em 09/09/2026 (ver o plano da fatia):
-- leitura cruzada devolve 0 linhas, INSERT cruzado e UPDATE cruzado sao
-- recusados. Zero linhas, porem, e indistinguivel de "nao ha dados" -- por
-- isso quem GARANTE o contexto e a aplicacao (PrismaService); esta politica
-- e a rede de seguranca, nao o controle primario.
--
-- app.actor = 'platform' cobre a sessao elevada de Super Admin (ADR-052
-- SS3), que le entre tenants por desenho e fica auditada. Nenhuma outra
-- excecao -- em particular, nao ha bypass para 'system': worker, outbox e
-- seed tambem setam app.tenant_id, porque operam em nome de um tenant por
-- vez. 'system' descreve QUEM roda, nao permissao de atravessar tenant.
CREATE POLICY tenant_isolation_students ON students
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  );

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  );
