import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import {
  deveBloquear,
  instanteDeBloqueio,
  type PoliticaDeBloqueio,
} from './domain/bloqueio-por-inadimplencia.js';

/**
 * Job de vencimento e bloqueio por inadimplencia. `MVP-02` 7, Slice 2.4:
 * "job de vencimento idempotente", "assinatura `PAST_DUE`",
 * "suspensao/revogacao de entitlement". `M2-FR-013` a `M2-FR-015`.
 *
 * ## A REGRA No 1 E O CORACAO DESTA FATIA
 *
 * Pagamento nao controla acesso -- entitlement controla (ADR-003). A cadeia e
 * `Invoice vencida -> Subscription PAST_DUE -> Entitlement SUSPENDED -> DENY`,
 * e a catraca continua sem saber o que e uma invoice: ela le entitlement, como
 * sempre leu. Este caso de uso e o unico ponto onde divida vira falta de
 * direito, e ele escreve no entitlement -- nao no motor.
 *
 * ## Idempotente por construcao, nao por `if`
 *
 * `M2-FR-013` pede job REEXECUTAVEL. Cada `updateMany` filtra pelo estado de
 * ORIGEM (`OPEN` -> `OVERDUE`, `ACTIVE` -> `PAST_DUE`), entao a segunda
 * execucao nao encontra nada para mudar e o resultado e identico. Nao ha
 * "ja processei?" a consultar -- o proprio `where` e a idempotencia.
 *
 * ## O que ele NAO faz
 *
 * Nao cobra, nao cancela assinatura, nao apaga historico (`M2-FR-015`:
 * "suspender sem apagar"). E nao desbloqueia: a volta e do webhook de
 * pagamento, que a F13 ja entregou -- `PAST_DUE -> ACTIVE` e
 * `SUSPENDED -> ACTIVE`, com `REVOKED` que NAO ressuscita.
 */

export interface ResultadoDaInadimplencia {
  readonly invoicesVencidas: number;
  readonly assinaturasEmAtraso: number;
  readonly direitosSuspensos: number;
}

/** Invoice candidata, com o que a politica precisa para decidir. */
interface Candidata {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly dueAt: Date;
  readonly blockAt: Date | null;
  readonly fusoDaUnidade: string;
  /** OPEN vira OVERDUE nesta passada; OVERDUE ja tinha virado num ciclo
   * anterior. So a transicao OPEN->OVERDUE publica `InvoiceOverdue`. */
  readonly status: 'OPEN' | 'OVERDUE';
}

@Injectable()
export class AplicarInadimplenciaUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * Aplica a inadimplencia de um tenant.
   *
   * `agora` entra por parametro (`CLAUDE.md`): o job roda por agendador, e a
   * unica forma de provar a linha do tempo em teste e injetando o instante.
   */
  async executar(tenantId: string, agora: Date): Promise<ResultadoDaInadimplencia> {
    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId },
      select: { graceDays: true, blockAnchor: true },
    });

    /**
     * SEM CONFIGURACAO, NAO BLOQUEIA NINGUEM. Assumir carencia zero seria
     * bloquear a academia inteira no dia do vencimento por causa de um
     * cadastro incompleto -- o erro mais caro que este job pode cometer.
     */
    if (!configuracao) {
      return { invoicesVencidas: 0, assinaturasEmAtraso: 0, direitosSuspensos: 0 };
    }

    const candidatas = await this.candidatas(tenantId, agora);

    const aBloquear = candidatas.filter((invoice) =>
      this.jaBloqueia(invoice, configuracao.graceDays, configuracao.blockAnchor, agora),
    );

    if (aBloquear.length === 0) {
      return { invoicesVencidas: 0, assinaturasEmAtraso: 0, direitosSuspensos: 0 };
    }

    return this.db.$transaction(async (tx) =>
      this.aplicar(tx, tenantId, aBloquear, agora, configuracao.graceDays),
    );
  }

  /**
   * Invoices em aberto cujo vencimento ja passou.
   *
   * O corte grosso e por `dueAt` em UTC -- barato e indexado. O corte FINO,
   * que respeita o fuso da unidade, acontece em memoria: filtrar por fuso no
   * SQL exigiria a conta de DST dentro do banco, e ela ja existe, testada,
   * como funcao pura.
   */
  private async candidatas(tenantId: string, agora: Date): Promise<Candidata[]> {
    // `comTenant` embora a raiz seja `invoices`: o `select` traz `student`,
    // que TEM politica RLS (F66). Fora de transacao interceptada o
    // `set_config` nunca aplica, e sob o role restrito o aninhado vem NULO
    // enquanto a raiz volta inteira -- o Prisma tipa a relacao como nao-nula,
    // entao nem o TypeScript nem o teste avisam (issue #306). Aqui o dano
    // seria o fuso da unidade sumir e o corte de vencimento errar o dia.
    //
    // O unico chamador e rota HTTP (`billing.controller.ts`), entao o
    // contexto ja esta aberto pelo interceptor. Worker que venha a chamar
    // isto precisa abrir o seu com `comContexto`.
    const invoices = await this.db.comTenant((tx) =>
      tx.invoice.findMany({
        where: {
          tenantId,
          status: { in: ['OPEN', 'OVERDUE'] },
          dueAt: { lte: agora },
        },
        select: {
          id: true,
          subscriptionId: true,
          dueAt: true,
          blockAt: true,
          status: true,
          student: { select: { gymUnit: { select: { timezone: true } } } },
        },
      }),
    );

    return invoices.map((invoice) => ({
      id: invoice.id,
      tenantId,
      subscriptionId: invoice.subscriptionId,
      dueAt: invoice.dueAt,
      blockAt: invoice.blockAt,
      status: invoice.status as 'OPEN' | 'OVERDUE',
      /**
       * Fuso da UNIDADE DO ALUNO, sem fallback (ADR-019 3). `gym_unit_id` e
       * obrigatorio em `students` desde a F45, entao o encadeamento nao pode
       * ser nulo -- e se um dia puder, `??` silencioso seria o bug de um dia
       * que o ADR existe para impedir.
       */
      fusoDaUnidade: invoice.student.gymUnit.timezone,
    }));
  }

  /**
   * A invoice ja passou do instante de bloqueio?
   *
   * `blockAt` CONGELADO VENCE A POLITICA ATUAL. O ADR-019 deixou em aberto o
   * que fazer quando a academia troca a carencia com aluno ja na regua; a
   * resposta aqui e: quem ja teve o instante calculado o mantem, e a politica
   * nova vale para quem vencer daqui pra frente.
   *
   * Recalcular sempre faria uma mudanca de configuracao alterar
   * RETROATIVAMENTE a situacao de quem ja estava em carencia -- alguem que
   * entrou ontem passaria a estar bloqueado desde anteontem, e ninguem
   * consegue explicar isso no balcao.
   */
  private jaBloqueia(
    invoice: Candidata,
    diasDeCarencia: number,
    ancora: PoliticaDeBloqueio['ancora'],
    agora: Date,
  ): boolean {
    if (invoice.blockAt !== null) {
      return agora.getTime() >= invoice.blockAt.getTime();
    }

    return deveBloquear(
      invoice.dueAt,
      { ancora, diasDeCarencia, fusoDaUnidade: invoice.fusoDaUnidade },
      agora,
    );
  }

  private async aplicar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoices: readonly Candidata[],
    agora: Date,
    diasDeCarencia: number,
  ): Promise<ResultadoDaInadimplencia> {
    const ids = invoices.map((invoice) => invoice.id);

    /**
     * CONGELA O INSTANTE na primeira vez que a invoice e vista bloqueando.
     * A partir daqui a politica pode mudar sem mexer em quem ja esta na
     * regua -- ver `jaBloqueia`.
     */
    for (const invoice of invoices) {
      if (invoice.blockAt !== null) continue;

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          blockAt: instanteDeBloqueio(invoice.dueAt, {
            ancora: 'DUE_PLUS_GRACE',
            diasDeCarencia,
            fusoDaUnidade: invoice.fusoDaUnidade,
          }),
        },
      });
    }

    /**
     * Cada passo filtra pelo estado de ORIGEM. E isso, e nao um `if`, que faz
     * o job ser reexecutavel (`M2-FR-013`): a segunda execucao nao encontra
     * nada para mudar.
     */
    const invoicesVencidas = await tx.invoice.updateMany({
      where: { id: { in: ids }, tenantId, status: 'OPEN' },
      data: { status: 'OVERDUE', version: { increment: 1 } },
    });

    /**
     * `InvoiceOverdue` -- F73 §4.2. So para quem TRANSICIONOU agora (estava
     * `OPEN` nesta leitura): reexecutar o job nao pode reemitir o aviso para
     * quem ja virou `OVERDUE` num ciclo anterior, senao o aluno recebe o
     * mesmo aviso todo dia enquanto a divida persistir.
     */
    for (const invoice of invoices.filter((item) => item.status === 'OPEN')) {
      await tx.outboxEvent.create({
        data: {
          tenantId: invoice.tenantId,
          eventType: 'InvoiceOverdue',
          aggregateType: 'Invoice',
          aggregateId: invoice.id,
          payload: {},
        },
      });
    }

    /**
     * RELE DENTRO DA TRANSACAO quais invoices continuam devendo.
     *
     * DEFEITO REAL, achado pela revisao de codigo e reproduzido antes de
     * corrigir: os `subscriptionIds` vinham da leitura PRE-TRANSACAO. Se o
     * webhook de pagamento comitasse na janela entre a leitura e a escrita, o
     * job suspendia de volta um entitlement que o pagamento acabara de
     * reativar -- medido: `invoicesVencidas: 0` (a invoice ja estava paga) e
     * `direitosSuspensos: 1`. O aluno pagava e ficava bloqueado na catraca.
     *
     * A lista boa e a que o BANCO ve agora, dentro da transacao. Invoice que
     * virou `PAID` no meio some daqui, e a assinatura dela nao e tocada.
     */
    const aindaDevendo = await tx.invoice.findMany({
      where: { id: { in: ids }, tenantId, status: 'OVERDUE' },
      select: { subscriptionId: true },
    });

    const subscriptionIds = [...new Set(aindaDevendo.map((i) => i.subscriptionId))];

    if (subscriptionIds.length === 0) {
      return {
        invoicesVencidas: invoicesVencidas.count,
        assinaturasEmAtraso: 0,
        direitosSuspensos: 0,
      };
    }

    const assinaturasEmAtraso = await tx.subscription.updateMany({
      where: { id: { in: subscriptionIds }, tenantId, status: 'ACTIVE' },
      data: { status: 'PAST_DUE', version: { increment: 1 } },
    });

    /**
     * SUSPENDE, NAO REVOGA (`M2-FR-015`: "sem apagar historico"). `SUSPENDED`
     * e reversivel pelo webhook de pagamento; `REVOKED` nao ressuscita, e
     * usa-lo aqui tornaria um atraso de tres dias irreversivel.
     *
     * `REVOKED` tambem NAO e tocado: quem revogou tinha outra razao, e um
     * atraso de pagamento nao pode reabrir essa decisao.
     */
    const direitosSuspensos = await tx.entitlement.updateMany({
      where: { subscriptionId: { in: subscriptionIds }, tenantId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspendedAt: agora, version: { increment: 1 } },
    });

    return {
      invoicesVencidas: invoicesVencidas.count,
      assinaturasEmAtraso: assinaturasEmAtraso.count,
      direitosSuspensos: direitosSuspensos.count,
    };
  }
}
