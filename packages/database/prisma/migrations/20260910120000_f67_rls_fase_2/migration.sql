-- F67 (SPEC-067, ADR-054 SS5-SS6): `tenant_id` nas tabelas que ainda dependiam
-- de JOIN para saber de quem e a linha, e politica RLS em TODAS as tabelas de
-- negocio -- nao apenas nas duas da fase 1.
--
-- Continua valendo o que a F66 estabeleceu: RLS e SEGUNDA CAMADA. Nenhum
-- `where` de repositorio sai daqui; a politica pega o que a aplicacao
-- deixar passar.
--
-- SEIS tabelas, e nao as nove do ADR-054 SS5. O ADR foi escrito antes de
-- conferir o schema, e tres das que ele nomeia NAO tem dono de tenant
-- (decisao do PI em 10/09/2026, ver DECISIONS.md ADR-054, emenda):
--   * `ai_prompt_versions` -- prompt e do PRODUTO, nao do tenant, e `name` e
--     unico GLOBALMENTE. Dar tenant_id quebraria a unicidade e a semantica.
--   * `kiosk_replay_nonces` -- anti-replay por `key_id`, sem laco com tenant.
--   * `index_values` (IPCA), `platform_admins`, `saas_plans` -- da
--     plataforma, nunca de uma academia; ficam com as globais do SS5
--     (`tenants`, `users`, `permissions`, `role_permissions`).

-- ---------------------------------------------------------------------------
-- 1. Coluna nula -> backfill pelo pai -> NOT NULL.
--
-- As tres etapas em UMA migration, e nao em tres deploys: a tabela nao tem
-- escritor concorrente novo entre elas (a coluna ainda nao existe no client
-- Prisma ate esta migration aplicar), e partir em tres deixaria uma janela em
-- que a coluna existe nula e a politica ja recusaria a linha.
--
-- O backfill herda do PAI. Verificado em 10/09/2026 contra o banco de
-- desenvolvimento: ZERO orfaos nas quatro tabelas com dado real (68 + 302 +
-- 5296 + 6 linhas), entao o `NOT NULL` ao fim nao tem o que recusar. As FKs
-- ja garantiam isso -- a checagem foi para provar, nao para supor.
-- ---------------------------------------------------------------------------

-- access_passages -> access_events
ALTER TABLE access_passages ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE access_passages p SET tenant_id = e.tenant_id
  FROM access_events e WHERE e.id = p.access_event_id AND p.tenant_id IS NULL;
ALTER TABLE access_passages ALTER COLUMN tenant_id SET NOT NULL;

-- plan_units -> plans
ALTER TABLE plan_units ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE plan_units u SET tenant_id = p.tenant_id
  FROM plans p WHERE p.id = u.plan_id AND u.tenant_id IS NULL;
ALTER TABLE plan_units ALTER COLUMN tenant_id SET NOT NULL;

-- plan_access_windows -> plans
ALTER TABLE plan_access_windows ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE plan_access_windows w SET tenant_id = p.tenant_id
  FROM plans p WHERE p.id = w.plan_id AND w.tenant_id IS NULL;
ALTER TABLE plan_access_windows ALTER COLUMN tenant_id SET NOT NULL;

-- entitlement_unit_windows -> entitlements
ALTER TABLE entitlement_unit_windows ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE entitlement_unit_windows w SET tenant_id = e.tenant_id
  FROM entitlements e WHERE e.id = w.entitlement_id AND w.tenant_id IS NULL;
ALTER TABLE entitlement_unit_windows ALTER COLUMN tenant_id SET NOT NULL;

-- ranking_entries -> ranking_snapshots
ALTER TABLE ranking_entries ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE ranking_entries r SET tenant_id = s.tenant_id
  FROM ranking_snapshots s WHERE s.id = r.snapshot_id AND r.tenant_id IS NULL;
ALTER TABLE ranking_entries ALTER COLUMN tenant_id SET NOT NULL;

-- replay_nonces -> edge_nodes
ALTER TABLE replay_nonces ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE replay_nonces n SET tenant_id = e.tenant_id
  FROM edge_nodes e WHERE e.id = n.edge_node_id AND n.tenant_id IS NULL;
ALTER TABLE replay_nonces ALTER COLUMN tenant_id SET NOT NULL;

-- `inbox_receipts` NAO entra. Ela nao tem pai de onde herdar -- nenhuma FK,
-- nenhuma coluna que leve a um tenant -- e nao tem escritor nem leitor em
-- todo o repositorio (verificado em 10/09/2026: a unica referencia fora de
-- teste e o tipo exportado em packages/database/src/index.ts). Inventar um
-- tenant para linha que nao existe seria dado inventado; a coluna entra na
-- fatia que der o primeiro uso a ela.

-- ---------------------------------------------------------------------------
-- 2. FK e indice.
--
-- A FK para `tenants` e o que impede a coluna nova de apontar para tenant
-- inexistente -- as outras 103 tabelas ja a tem, e sem ela `tenant_id` seria
-- um uuid solto que a politica compara e ninguem valida.
--
-- O indice em `tenant_id` e o que a politica USA: toda leitura passa a
-- carregar `tenant_id = current_setting(...)` no plano, e sem indice isso
-- vira sequential scan em tabela que hoje ja tem 5296 linhas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'access_passages', 'plan_units', 'plan_access_windows',
    'entitlement_unit_windows', 'ranking_entries', 'replay_nonces'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) '
      || 'REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE', t, t || '_tenant_id_fkey');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)',
      t || '_tenant_id_idx', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. A POLITICA NAS DEMAIS TABELAS NAO ENTRA NESTA FATIA.
--
-- O ADR-054 SS5 pede politica em toda tabela com `tenant_id`. Esta migration
-- entrega a METADE que estava pronta -- as seis colunas acima -- e NAO liga a
-- politica nas outras ~100 tabelas. A F68 faz isso. O motivo e concreto, e foi
-- medido em 10/09/2026 com a politica ligada:
--
-- 1. SEIS TABELAS DE AUTENTICACAO nao podem ter politica nenhuma.
--    `sessions`, `tenant_memberships`, `roles`, `user_roles`, `invitations` e
--    `support_elevations` tem `tenant_id`, mas sao o caminho que DESCOBRE o
--    tenant: a sessao e resolvida por `tokenHash` antes de existir contexto, e
--    o login le o vinculo justamente para saber a que tenant a pessoa
--    pertence. Com politica, a leitura sem contexto devolve zero e a API
--    responde "credenciais invalidas" com a senha certa, o usuario ATIVO e o
--    vinculo ATIVO. Verificado no banco: sem contexto, 0 vinculos; com
--    contexto, 1.
--
-- 2. AS 394 QUERIES FORA DE TRANSACAO nao recebem contexto. O `set_config` so
--    entra no `$transaction` interativo (F66). Isso bastava com politica em
--    duas tabelas, lidas por repositorios que ja usavam transacao; com ~100
--    tabelas, toda chamada do tipo `this.db.plan.findMany()` passa a devolver
--    LISTA VAZIA. Verificado na tela: a pagina de planos carregou vazia com 6
--    planos no banco.
--
-- O (2) exige mudar como o contexto chega ao Prisma, e a tentativa desta fatia
-- nao vingou: o `$extends` do Prisma 7 nao despacha quando os modelos sao
-- redirecionados a partir do construtor. E trabalho de uma fatia propria, com
-- experimento INSTRUMENTADO -- medir so o resultado engana, porque a query cai
-- de volta no caminho antigo e o verde aparece sem o desenho ter rodado.
--
-- O que fica valendo daqui: as seis colunas, com `tenant_id` proprio e FK, que
-- sao pre-requisito da politica e nao dependem de nada disso. E a guarda de
-- integracao que impede a proxima tabela de nascer sem `tenant_id`.

-- `audit_logs` mantem a restricao da F66: a aplicacao le e insere, nunca edita
-- nem apaga. Repetido aqui porque `ALTER DEFAULT PRIVILEGES` nao alcanca
-- tabela ja existente, e o GRANT amplo da F66 poderia devolver o que este
-- REVOKE tirou.
REVOKE UPDATE, DELETE ON audit_logs FROM arenahub_app;

-- ---------------------------------------------------------------------------
-- 4. Desfaz a politica que uma execucao ANTERIOR desta migration criou.
--
-- Necessario porque a migration ja rodou -- com a politica em todas as tabelas
-- -- nos bancos de desenvolvimento, integracao e E2E antes de a fatia ser
-- reduzida. Sem este bloco, quem migrou antes fica com a aplicacao quebrada, e
-- nada no caminho normal a consertaria: migration aplicada nao roda de novo.
--
-- `DISABLE` junto com o `DROP POLICY`: RLS ligado SEM politica nenhuma NEGA
-- TUDO no Postgres, entao remover so a politica deixaria a tabela pior do que
-- antes.
--
-- `students` e `audit_logs` ficam de FORA da limpeza: a politica delas e da
-- F66 e continua valendo.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('students', 'audit_logs')
       AND EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || t, t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
