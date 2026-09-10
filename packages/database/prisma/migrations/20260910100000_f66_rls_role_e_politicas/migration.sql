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

-- 2. Permissao de DADO, nao de ESTRUTURA.
--
-- Este e o role de RUNTIME: a API inteira roda com ele, entao precisa de
-- leitura e escrita em TODAS as tabelas de negocio, e nao so nas duas com
-- politica. O que o separa do dono nao e alcance de tabela -- e nao ter
-- ownership, nao poder DROP nem ALTER, nao poder criar ou derrubar
-- politica, e nao ter BYPASSRLS.
--
-- Conceder apenas `students` e `audit_logs` derruba a aplicacao inteira no
-- primeiro login, com `permission denied for table tenants`.
GRANT USAGE ON SCHEMA public TO arenahub_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arenahub_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arenahub_app;

-- Tabela criada por migration FUTURA nasceria sem GRANT nenhum, e a falha so
-- apareceria em execucao. O default privilege cobre o que o dono criar daqui
-- em diante.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arenahub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO arenahub_app;

-- `audit_logs` e a excecao restritiva, e por isso vem DEPOIS do GRANT amplo:
-- trilha de auditoria que a aplicacao pode editar nao e trilha de auditoria.
REVOKE UPDATE, DELETE ON audit_logs FROM arenahub_app;

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
