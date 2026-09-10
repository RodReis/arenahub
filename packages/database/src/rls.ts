import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * O contexto que toda operacao precisa declarar antes de tocar tabela com
 * politica RLS -- ADR-054 SS3/SS4.
 *
 * Isto NAO substitui o `TenantContext` da API. Aquele e a camada 1 (o
 * repositorio recebe o tenant e filtra); este e o que a camada 2 precisa
 * para montar o `set_config` da transacao. Os dois coexistem, e a fatia
 * inteira depende de nenhum repositorio perder o `where` por causa disto.
 *
 * `system` cobre worker, outbox, edge-sync e seed. Ele descreve QUEM roda --
 * nao autoriza atravessar tenant, e por isso carrega `tenantId` obrigatorio.
 * Quem varre varios tenants abre um escopo por tenant, dentro do laco.
 *
 * `platform` e a unica excecao ao isolamento, e existe so para a sessao
 * elevada de Super Admin (ADR-052 SS3), que le entre tenants por desenho e
 * fica auditada.
 */
export type TenantDbContext =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'system'; tenantId: string }
  | { kind: 'platform' };

/** Nome de GUC e valor, na ordem em que entram na transacao. */
export type Guc = readonly [nome: string, valor: string];

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Erro de dominio para operacao que chegou ao banco sem contexto.
 *
 * Existe porque a alternativa e pior: a politica RLS, sozinha, devolveria
 * ZERO LINHAS para uma leitura sem contexto -- e zero linhas e
 * indistinguivel de "nao ha dados". O bug ficaria invisivel ate alguem
 * reparar que uma tela vazia deveria ter conteudo. Falhar alto e a decisao
 * do ADR-054 SS3: "operacao sem contexto falha, nao devolve vazio".
 */
export class SemContextoDeTenantError extends Error {
  readonly code = 'SEM_CONTEXTO_DE_TENANT';

  constructor() {
    super(
      'Operacao de banco sem contexto de tenant. Abra o escopo com ' +
        '`comContexto(...)` -- em requisicao HTTP isso e automatico; em ' +
        'worker, seed ou script, e explicito.',
    );
    this.name = 'SemContextoDeTenantError';
  }
}

/**
 * O contexto da operacao em curso.
 *
 * `AsyncLocalStorage`, e nao variavel de modulo, porque o pool de conexoes e
 * compartilhado e duas requisicoes correm ao mesmo tempo: uma variavel
 * global faria o tenant de uma vazar para a outra, de forma intermitente e
 * dependente de temporizacao -- a pior classe de bug de isolamento.
 */
export const contextoRls = new AsyncLocalStorage<TenantDbContext>();

/** Roda `fn` com o contexto dado. Fora do escopo, o contexto some. */
export function comContexto<T>(contexto: TenantDbContext, fn: () => Promise<T>): Promise<T> {
  gucsDoContexto(contexto); // valida antes de abrir o escopo
  return contextoRls.run(contexto, fn);
}

/**
 * Traduz o contexto nas GUCs que a politica le, na ordem de aplicacao.
 *
 * O valor vai como PARAMETRO de `set_config($1, $2, true)`, nunca
 * interpolado em SQL -- ver `aplicarContextoNaTransacao`. A validacao de
 * uuid aqui e defesa em profundidade: hoje nao ha string montada a mao, e
 * se alguem trocar por interpolacao amanha, o valor ja chega validado.
 */
export function gucsDoContexto(contexto: TenantDbContext): Guc[] {
  if (contexto.kind === 'platform') return [['app.actor', 'platform']];

  const { tenantId } = contexto;

  if (!tenantId) {
    throw new Error(
      `contexto '${contexto.kind}' exige tenantId: sem ele a politica nao casa e a ` +
        'query devolveria zero linhas em silencio',
    );
  }

  if (!REGEX_UUID.test(tenantId)) {
    throw new Error(`tenantId precisa ser uuid; recebido: ${JSON.stringify(tenantId)}`);
  }

  return contexto.kind === 'system'
    ? [
        ['app.actor', 'system'],
        ['app.tenant_id', tenantId],
      ]
    : [['app.tenant_id', tenantId]];
}

/** O minimo do client de transacao que este modulo precisa. */
export interface ExecutorDeTransacao {
  $executeRawUnsafe(sql: string, ...valores: unknown[]): Promise<number>;
}

/**
 * Aplica o contexto DENTRO da transacao recebida, antes de qualquer query
 * dela.
 *
 * O terceiro argumento `true` de `set_config` e o que torna o efeito local a
 * transacao -- equivale a `SET LOCAL`, mas aceita parametro, coisa que `SET
 * LOCAL` nao faz. Sessao nao serve: o pool reusa a conexao, e o valor
 * sobreviveria para a proxima requisicao.
 *
 * O contexto tem de entrar NESTA transacao, e nao numa aberta a parte. O
 * padrao publicado na documentacao do Prisma para RLS envolve cada query num
 * `$transaction([set_config, query])` proprio; verificado contra Postgres 17
 * em 09/09/2026, isso roda em OUTRA conexao quando ja existe transacao
 * aberta -- e o `set_config` nao alcanca a transacao de fora. Como este
 * repositorio tem mais de trinta transacoes interativas, o efeito seria
 * escrita recusada com 42501 em toda uma classe de casos de uso.
 */
export async function aplicarContextoNaTransacao(
  tx: ExecutorDeTransacao,
  contexto: TenantDbContext,
): Promise<void> {
  for (const [nome, valor] of gucsDoContexto(contexto)) {
    await tx.$executeRawUnsafe('SELECT set_config($1, $2, true)', nome, valor);
  }
}

/** O contexto em curso, ou erro. Nunca devolve indefinido. */
export function contextoObrigatorio(): TenantDbContext {
  const contexto = contextoRls.getStore();

  if (!contexto) throw new SemContextoDeTenantError();

  return contexto;
}
