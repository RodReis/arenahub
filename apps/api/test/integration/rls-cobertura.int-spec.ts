import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { criarPrismaClient, type PrismaClientArenaHub } from '@arenahub/database';

/**
 * F67 -- `tenant_id` proprio nas tabelas que dependiam de `JOIN` para saber de
 * quem e a linha (SPEC-067, ADR-054 SS5).
 *
 * O QUE ESTA FATIA ENTREGOU, e o que NAO entregou. A coluna nas seis tabelas
 * -- pre-requisito de qualquer politica -- entrou. A politica nas ~100 tabelas
 * com `tenant_id` NAO entrou, e foi para a F68 por duas razoes medidas em
 * 10/09/2026, ambas registradas na migration desta fatia:
 *
 *   1. Seis tabelas de autenticacao (`sessions`, `tenant_memberships`, ...)
 *      sao o caminho que DESCOBRE o tenant. Com politica, o login recusa
 *      credencial correta.
 *   2. As 394 queries fora de transacao nao recebem contexto, porque o
 *      `set_config` so entra no `$transaction` interativo (F66). Com politica
 *      em ~100 tabelas, a tela de planos carrega vazia com 6 planos no banco.
 *
 * Este arquivo prova o que entrou: as colunas existem, sao NOT NULL, tem FK, e
 * nenhuma linha diverge do tenant do pai. A guarda final impede a proxima
 * tabela de nascer sem `tenant_id` -- que e o buraco que a F67 veio fechar.
 *
 * O isolamento sob o role restrito continua provado em
 * `rls-isolation.int-spec.ts` (F66), nas duas tabelas com politica.
 */
describe('F67 -- `tenant_id` proprio, sem depender de JOIN', () => {
  let db: PrismaClientArenaHub;

  const sufixo = randomUUID().slice(0, 8);

  let tenantA: string;

  /**
   * As seis que ganharam a coluna nesta fatia, com o pai de onde o backfill a
   * herdou. O par (tabela, pai) e o que a checagem de divergencia usa.
   */
  const COLUNAS_NOVAS = [
    { tabela: 'access_passages', pai: 'access_events', fk: 'access_event_id' },
    { tabela: 'plan_units', pai: 'plans', fk: 'plan_id' },
    { tabela: 'plan_access_windows', pai: 'plans', fk: 'plan_id' },
    { tabela: 'entitlement_unit_windows', pai: 'entitlements', fk: 'entitlement_id' },
    { tabela: 'ranking_entries', pai: 'ranking_snapshots', fk: 'snapshot_id' },
    { tabela: 'replay_nonces', pai: 'edge_nodes', fk: 'edge_node_id' },
  ];

  /**
   * Tabelas de proposito SEM `tenant_id`.
   *
   * `tenants`, `users`, `permissions` e `role_permissions` sao as globais do
   * ADR-054 SS5. As outras foram apuradas contra o schema em 10/09/2026 e
   * confirmadas pelo PI: `ai_prompt_versions` (prompt e do produto, e `name` e
   * unico GLOBALMENTE -- dar tenant quebraria a unicidade),
   * `kiosk_replay_nonces` (anti-replay por `key_id`, sem laco com tenant),
   * `index_values` (IPCA), `platform_admins` e `saas_plans` (da plataforma).
   * `inbox_receipts` fica fora enquanto nao tiver escritor: nao ha pai de onde
   * herdar, e inventar um tenant seria dado inventado.
   */
  const SEM_TENANT_POR_DECISAO = [
    'tenants',
    'users',
    'permissions',
    'role_permissions',
    'ai_prompt_versions',
    'kiosk_replay_nonces',
    'index_values',
    'platform_admins',
    'saas_plans',
    'inbox_receipts',
  ];

  beforeAll(async () => {
    db = criarPrismaClient();

    const tenant = await db.tenant.create({
      data: {
        slug: `f67-a-${sufixo}`,
        legalName: `RLS2 a LTDA`,
        displayName: `RLS2 a`,
      },
    });

    tenantA = tenant.id;
  }, 60_000);

  afterAll(async () => {
    // `onDelete: Cascade` no tenant leva junto tudo o que foi montado.
    await db.tenant.deleteMany({ where: { id: tenantA } });

    await db.$disconnect();
  });

  it('as seis tabelas ganharam `tenant_id` NOT NULL', async () => {
    const colunas = await db.$queryRawUnsafe<{ tabela: string; nulo: string }[]>(
      `SELECT table_name AS tabela, is_nullable AS nulo
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      COLUNAS_NOVAS.map((c) => c.tabela),
    );

    expect(colunas).toHaveLength(COLUNAS_NOVAS.length);
    expect(colunas.every((c) => c.nulo === 'NO')).toBe(true);
  });

  it('cada `tenant_id` novo tem chave estrangeira para `tenants`', async () => {
    // Sem FK a coluna seria um uuid solto: apontaria para tenant inexistente e
    // ninguem recusaria. As outras 103 tabelas ja a tem.
    const semFk = await db.$queryRawUnsafe<{ tabela: string }[]>(
      `SELECT t.tabela
         FROM unnest($1::text[]) AS t(tabela)
        WHERE NOT EXISTS (
          SELECT 1
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema = tc.table_schema
           WHERE tc.table_schema = 'public'
             AND tc.constraint_type = 'FOREIGN KEY'
             AND tc.table_name = t.tabela
             AND kcu.column_name = 'tenant_id'
        )
        ORDER BY t.tabela`,
      COLUNAS_NOVAS.map((c) => c.tabela),
    );

    expect(semFk.map((l) => l.tabela)).toEqual([]);
  });

  it('nenhuma linha diverge do tenant do pai', async () => {
    // A prova de que o backfill herdou certo. Roda contra o dado REAL do banco
    // de integracao, e nao contra um cenario montado -- uma linha herdada do
    // pai errado nao apareceria num cenario de duas linhas.
    const divergentes: { tabela: string; linhas: number }[] = [];

    for (const { tabela, pai, fk } of COLUNAS_NOVAS) {
      const linhas = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n
           FROM ${tabela} f
           JOIN ${pai} p ON p.id = f.${fk}
          WHERE p.tenant_id <> f.tenant_id`,
      );

      const n = Number(linhas[0]?.n ?? 0);

      if (n > 0) divergentes.push({ tabela, linhas: n });
    }

    expect(divergentes).toEqual([]);
  });

  it('a escrita grava o `tenant_id` que o pai tem', async () => {
    // O contrapeso da checagem acima: ela olha o dado que JA existe, e passaria
    // numa tabela vazia. Este caso escreve pelo caminho da aplicacao.
    const plano = await db.plan.create({
      data: { tenantId: tenantA, name: `Plano F67 ${sufixo}` },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenantA,
        code: `U-${sufixo}`,
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const janela = await db.planAccessWindow.create({
      data: {
        tenantId: tenantA,
        planId: plano.id,
        gymUnitId: unidade.id,
        dayOfWeek: 1,
        startMinute: 480,
        endMinute: 1200,
      },
    });

    expect(janela.tenantId).toBe(plano.tenantId);
  });

  it('a coluna nova recusa tenant inexistente', async () => {
    // A FK em acao. Sem ela, `tenant_id` aceitaria qualquer uuid -- e a
    // politica da F68 compararia contra um valor que ninguem validou.
    const plano = await db.plan.findFirstOrThrow({ where: { tenantId: tenantA } });
    const unidade = await db.gymUnit.findFirstOrThrow({ where: { tenantId: tenantA } });

    await expect(
      db.planAccessWindow.create({
        data: {
          tenantId: randomUUID(),
          planId: plano.id,
          gymUnitId: unidade.id,
          dayOfWeek: 2,
          startMinute: 600,
          endMinute: 700,
        },
      }),
    ).rejects.toThrow();
  });

  it('toda tabela de negocio tem `tenant_id`, menos as decididas sem ele', async () => {
    /*
     * A GUARDA da fatia, e o que sobrevive a ela.
     *
     * Ela le o CATALOGO, nao uma lista escrita a mao: tabela nova sem
     * `tenant_id` derruba este teste, e quem a criar decide -- e registra -- se
     * ela e de tenant ou global. Foi exatamente esse buraco que a F67 veio
     * fechar: seis tabelas dependiam de `JOIN` porque ninguem tinha reparado.
     *
     * `_prisma_migrations` fica fora por ser tabela de ferramenta.
     */
    const semTenant = await db.$queryRawUnsafe<{ tabela: string }[]>(
      `SELECT c.relname AS tabela
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> '_prisma_migrations'
          AND c.relname <> ALL ($1::text[])
          AND NOT EXISTS (
            SELECT 1
              FROM pg_attribute a
             WHERE a.attrelid = c.oid
               AND a.attname = 'tenant_id'
               AND NOT a.attisdropped
          )
        ORDER BY c.relname`,
      SEM_TENANT_POR_DECISAO,
    );

    expect(semTenant.map((l) => l.tabela)).toEqual([]);
  });

  it('as globais seguem sem `tenant_id`, de proposito', async () => {
    // O contrapeso da guarda acima: sem este caso, alguem "consertaria" o
    // vermelho adicionando `tenant_id` a uma tabela global, e a lista de
    // excecoes viraria porta aberta.
    const comColuna = await db.$queryRawUnsafe<{ tabela: string }[]>(
      `SELECT table_name AS tabela
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      SEM_TENANT_POR_DECISAO,
    );

    expect(comColuna.map((l) => l.tabela)).toEqual([]);
  });

  it('as tabelas de autenticacao seguem SEM politica -- ver F68', async () => {
    /*
     * Registra no teste a decisao do PI de 10/09/2026, para que a F68 nao a
     * refaca por engano.
     *
     * `sessions` e `tenant_memberships` sao lidas ANTES de existir contexto de
     * tenant -- e delas que o tenant sai. Com politica, a leitura sem contexto
     * devolve zero e o login recusa credencial correta. Verificado no banco:
     * sem contexto, 0 vinculos; com contexto, 1.
     */
    const comPolitica = await db.$queryRawUnsafe<{ tabela: string }[]>(
      `SELECT DISTINCT tablename AS tabela
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tabela`,
      ['sessions', 'tenant_memberships', 'roles', 'user_roles', 'invitations', 'support_elevations'],
    );

    expect(comPolitica.map((l) => l.tabela)).toEqual([]);
  });
});
