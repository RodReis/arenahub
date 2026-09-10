import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  aplicarContextoNaTransacao,
  contextoRls,
  Prisma,
  PrismaClient,
  PrismaPg,
  SemContextoDeTenantError,
  type TenantDbContext,
} from '@arenahub/database';

/**
 * Modelos com politica RLS ativa (F66). So eles exigem contexto.
 *
 * A lista existe porque a fase 1 poe politica em duas tabelas. Exigir
 * contexto para TODA operacao quebraria de uma vez o que ainda nao foi
 * convertido -- login, webhook de pagamento, health check --, sem nada a
 * ganhar: onde nao ha politica, o banco nao recusa nada. A F67 poe politica
 * em todas as tabelas com `tenant_id`, e entao esta lista sai e a exigencia
 * passa a ser geral.
 */
export const MODELOS_COM_RLS: ReadonlySet<string> = new Set(['Student', 'AuditLog']);

/**
 * Client do Prisma com ciclo de vida amarrado ao do modulo, e com o contexto
 * de tenant aplicado a cada transacao (F66, ADR-054).
 *
 * ESTENDE o client em vez de embrulha-lo. Delegar model a model exigiria
 * anotar o tipo de cada um a mao -- o tipo gerado pelo Prisma nao e nomeavel
 * de fora do pacote (TS2742) -- e cada modelo novo viraria uma linha nova
 * aqui, esquecida na primeira pressa.
 *
 * COMO O CONTEXTO CHEGA AO BANCO. O `set_config` entra como primeiro comando
 * DENTRO da transacao que a operacao ja vai usar, nunca numa transacao a
 * parte. O padrao publicado na documentacao do Prisma para RLS faz o
 * contrario -- envolve cada query num `$transaction([set_config, query])`
 * proprio -- e, verificado contra Postgres 17 em 09/09/2026, isso roda em
 * OUTRA conexao quando ja existe transacao aberta. Como este repositorio tem
 * mais de trinta transacoes interativas, o efeito seria escrita recusada com
 * `42501` em toda uma classe de casos de uso.
 *
 * `$extends` tambem nao serve como caminho principal: ele devolve uma
 * INSTANCIA NOVA (verificado), e os 81 pontos que injetam este servico
 * continuariam com a antiga. Por isso a intercepcao mora aqui, no proprio
 * `$transaction`, que a instancia injetada ja expoe.
 *
 * Os repositorios nao mudam. O tenant vem do `AsyncLocalStorage` que o
 * `TenantRlsInterceptor` abre por requisicao; worker, seed e script abrem o
 * seu com `comContexto`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // O role restrito e o normal de execucao; o dono fica para as
    // migrations. Cair no `DATABASE_URL` mantem de pe quem ainda nao criou o
    // role -- e seguro porque as tabelas com politica levam FORCE ROW LEVEL
    // SECURITY, que sujeita tambem o dono a ela.
    // `||`, e nao `??`: string VAZIA precisa cair no `DATABASE_URL`. Quem
    // quer desligar o role restrito para um processo (o E2E, que aponta a API
    // para o banco proprio) passa a variavel vazia -- `delete` nao alcanca um
    // processo filho, e `??` deixaria a string vazia passar adiante e quebrar
    // a conexao.
    const connectionString = process.env['RUNTIME_DATABASE_URL'] || process.env['DATABASE_URL'];

    if (!connectionString) {
      throw new Error(
        'Nem RUNTIME_DATABASE_URL nem DATABASE_URL definidas. Copie .env.example ' +
          'para .env na raiz do monorepo.',
      );
    }

    // Driver adapter e obrigatorio no Prisma 7: o client virou TypeScript
    // puro, sem engine binario, e a conexao passa a ser de um driver do
    // ecossistema Node.
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  /**
   * Abre a transacao ja com o contexto de tenant aplicado.
   *
   * So a forma interativa (callback) e interceptada. A forma em array
   * (batch) cai direto no `super`: os dois usos dela hoje tocam `sessions` e
   * `invoices`, que ainda nao tem politica. Quando a F67 puser politica
   * nessas tabelas, os dois precisam virar transacao interativa -- caso
   * contrario falham com `42501`.
   */
  // As sobrecargas repetem as do client gerado, e nao podem ser afrouxadas
  // para `unknown[]`: os chamadores inferem o tipo de `tx` a partir daqui, e
  // uma assinatura larga faria `tx` virar `any` implicito em cada um deles.
  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(
    operacoes: [...P],
    opcoes?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<{ [K in keyof P]: Awaited<P[K]> }>;
  override $transaction<R>(
    executar: (tx: Prisma.TransactionClient) => Promise<R>,
    opcoes?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<R>;
  override $transaction(primeiro: unknown, opcoes?: unknown): Promise<unknown> {
    const chamarSuper = super.$transaction.bind(this) as (
      a: unknown,
      b?: unknown,
    ) => Promise<unknown>;

    if (typeof primeiro !== 'function') return chamarSuper(primeiro, opcoes);

    const executar = primeiro as (tx: Prisma.TransactionClient) => Promise<unknown>;

    return chamarSuper(async (tx: Prisma.TransactionClient) => {
      const contexto = contextoRls.getStore();

      // Sem contexto a transacao segue sem `set_config`: quem tocar tabela
      // protegida ali dentro ve zero linhas ou toma `42501` do proprio
      // banco. Lancar aqui derrubaria toda transacao que nao toca tabela
      // nenhuma com politica -- e a fase 1 cobre duas tabelas.
      if (contexto) {
        await aplicarContextoNaTransacao(tx, contexto);
      }

      return executar(tx);
    }, opcoes);
  }

  /**
   * Roda `fn` numa transacao com o contexto aplicado, exigindo que ele
   * exista.
   *
   * E o caminho de quem toca `students` ou `audit_logs` FORA de uma
   * transacao. A diferenca para o `$transaction` acima e o rigor: aqui a
   * ausencia de contexto e erro, porque a operacao declarou que vai tocar
   * tabela protegida. Devolver lista vazia no lugar seria indistinguivel de
   * "nao ha dados" -- exatamente o que o ADR-054 SS3 proibe.
   */
  comTenant<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const contexto: TenantDbContext | undefined = contextoRls.getStore();

    if (!contexto) throw new SemContextoDeTenantError();

    return this.$transaction(fn);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
