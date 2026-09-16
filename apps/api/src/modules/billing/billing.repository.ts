import { Injectable } from '@nestjs/common';
import type { Invoice, Payment, Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  competenciaDe,
  instanteDeBloqueio,
  proximoVencimento,
} from './domain/ciclo-de-cobranca.js';
import { precoVigenteEm } from './domain/dinheiro.js';
import { abrirInvoice, aplicarPagamento, podeTransicionar } from './domain/invoice.js';

export class AssinaturaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('SUBSCRIPTION_NOT_FOUND', 404, 'Assinatura nao encontrada');
  }
}

export class ConfiguracaoFinanceiraAusenteError extends ErroDeDominio {
  constructor() {
    super(
      'BILLING_SETTINGS_MISSING',
      409,
      'Tenant sem configuracao financeira; defina vencimento e carencia antes de cobrar',
    );
  }
}

export class PlanoSemPrecoVigenteError extends ErroDeDominio {
  constructor() {
    super('PLAN_WITHOUT_ACTIVE_PRICE', 409, 'Plano sem preco vigente na data de competencia');
  }
}

export class InvoiceNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('INVOICE_NOT_FOUND', 404, 'Invoice nao encontrada');
  }
}

export class AlunoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
  }
}

export class TransicaoDeInvoiceInvalidaError extends ErroDeDominio {
  constructor(de: string, para: string) {
    super('INVOICE_INVALID_TRANSITION', 409, `Invoice em ${de} nao vai para ${para}`);
  }
}

@Injectable()
export class BillingRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Abre a invoice do periodo a partir da assinatura.
   *
   * IDEMPOTENTE POR INV-066: uma invoice por `(tenant, assinatura,
   * competencia)`. Chamar duas vezes no mesmo mes devolve a MESMA invoice em
   * vez de criar a segunda -- e o que permite o ciclo rodar de novo depois
   * de uma falha sem cobrar o aluno duas vezes.
   *
   * O valor e COPIADO do preco vigente, nao referenciado: INV-068 diz que
   * moeda e valor nao mudam depois da abertura, e o preco do plano pode
   * mudar amanha. Copiar congela; referenciar reescreveria o passado.
   */
  async abrirInvoiceDoPeriodo(
    contexto: TenantContext,
    entrada: { subscriptionId: string; emQue: Date },
  ): Promise<Invoice> {
    const competencia = competenciaDe(entrada.emQue);

    const assinatura = await this.db.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const preco = precoVigenteEm(assinatura.plan.prices, competencia);

    if (!preco) {
      throw new PlanoSemPrecoVigenteError();
    }

    const vencimento = proximoVencimento(competencia, configuracao.dueDay);
    const totais = abrirInvoice({
      itens: [{ quantity: 1, unitAmountMinor: preco.amountMinor }],
      discountMinor: 0,
      dueAt: vencimento,
    });

    return this.db.$transaction(async (tx) => {
      // Idempotencia ANTES de consumir numero: sem isto, a segunda chamada
      // gastaria um numero de invoice para depois descobrir que a linha ja
      // existe -- e a numeracao ficaria com buraco.
      const jaExiste = await tx.invoice.findUnique({
        where: {
          tenantId_subscriptionId_billingPeriod: {
            tenantId: contexto.tenantId,
            subscriptionId: entrada.subscriptionId,
            billingPeriod: competencia,
          },
        },
      });

      if (jaExiste) {
        return jaExiste;
      }

      const numero = await this.proximoNumero(tx, contexto.tenantId);

      const invoice = await tx.invoice.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId: entrada.subscriptionId,
          // No plano familiar a invoice e do TITULAR: dependente tem acesso,
          // nao tem cobranca.
          studentId: assinatura.studentId,
          billingPeriod: competencia,
          status: 'OPEN',
          number: numero,
          currency: preco.currency,
          subtotalMinor: totais.subtotalMinor,
          discountMinor: totais.discountMinor,
          totalMinor: totais.totalMinor,
          dueAt: vencimento,
          blockAt: instanteDeBloqueio(vencimento, configuracao.graceDays),
          items: {
            create: [
              {
                tenantId: contexto.tenantId,
                description: assinatura.plan.name,
                quantity: 1,
                unitAmountMinor: preco.amountMinor,
                totalMinor: preco.amountMinor,
              },
            ],
          },
        },
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoiceOpened',
        payload: { number: numero, totalMinor: totais.totalMinor },
      });

      return invoice;
    });
  }

  /**
   * Registra pagamento manual -- dinheiro ou transferencia reconhecidos na
   * recepcao. E o caminho que fecha a Slice 2.1 SEM adapter de provedor.
   *
   * `recognizedByUserId` e obrigatorio aqui, e nao por preciosismo: com a
   * dupla permissao fora do MVP 2 (emenda de 18/08/2026), este campo e a
   * unica coisa que liga o dinheiro a uma pessoa. O controle deixou de ser
   * preventivo e passou a ser DETECTIVO -- ele nao impede o registro
   * inflado, permite achar depois (ADR-027, consequencia 3).
   */
  async registrarPagamentoManual(
    contexto: TenantContext,
    entrada: { invoiceId: string; amountMinor: number; reason: string; paidAt: Date },
    correlationId: string,
  ): Promise<Payment> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaError();
    }

    if (!podeTransicionar(invoice.status, 'PAID')) {
      throw new TransicaoDeInvoiceInvalidaError(invoice.status, 'PAID');
    }

    // Rejeita parcial e calcula o troco que vira credito. A regra mora no
    // dominio puro, testada sem banco.
    const resultado = aplicarPagamento(invoice.totalMinor, entrada.amountMinor);

    return this.db.$transaction(async (tx) => {
      const pagamento = await tx.payment.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          amountMinor: entrada.amountMinor,
          currency: invoice.currency,
          method: 'MANUAL',
          status: 'CONFIRMED',
          paidAt: entrada.paidAt,
          recognizedByUserId: contexto.actorId,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: entrada.paidAt, version: { increment: 1 } },
      });

      // Sobrepagamento vira credito do aluno (ADR-027, resposta 4 do PI).
      // `originPaymentId` e obrigatorio: credito sem origem rastreavel e o
      // buraco que a mitigacao detectiva existe para fechar.
      if (resultado.creditoMinor > 0) {
        await tx.accountCredit.create({
          data: {
            tenantId: contexto.tenantId,
            studentId: invoice.studentId,
            originPaymentId: pagamento.id,
            amountMinor: resultado.creditoMinor,
            currency: invoice.currency,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.manual',
          target: 'Payment',
          targetId: pagamento.id,
          correlationId,
          metadata: {
            invoiceId: invoice.id,
            amountMinor: entrada.amountMinor,
            creditoMinor: resultado.creditoMinor,
            reason: entrada.reason,
          },
        },
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoicePaid',
        payload: { paymentId: pagamento.id, method: 'MANUAL' },
      });

      return pagamento;
    });
  }

  /**
   * Invoices do aluno, mais recente primeiro, com o fuso da unidade de
   * origem do aluno.
   *
   * Escopo do tenant no `where`, sempre: regra de arquitetura no 2. Sem
   * ele, um id de outro tenant devolveria dado que nao e de quem pergunta.
   *
   * Fuso da UNIDADE DE ORIGEM do aluno (INV-144, ADR-019) -- sem fallback
   * para o tenant, que e exatamente o que o invariante proibe.
   *
   * A invoice nao tem `gym_unit_id` (financeiro nao e dado fisico,
   * ADR-027), entao o fuso vem pelo aluno. Nao ha aluno sem unidade: a F45
   * tornou a coluna `NOT NULL`.
   */
  async listarInvoicesDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<InvoicesDoAlunoComFuso> {
    // `comTenant`: `students` tem politica RLS (F66) e, fora de transacao
    // interceptada, o `set_config` nunca aplica -- sob o role restrito a
    // leitura volta VAZIA e o aluno legitimo vira "nao encontrado"
    // (issue #306).
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: studentId, tenantId: contexto.tenantId },
        include: { gymUnit: { select: { timezone: true } } },
      }),
    );

    if (!aluno) {
      throw new AlunoNaoEncontradoError();
    }

    const invoices = await this.db.invoice.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      include: { items: true, payments: true },
      /*
       * `dueAt` PRIMEIRO, e `id` como desempate -- ordem TOTAL.
       *
       * Ate a F53 esta consulta ordenava por `billingPeriod desc`, sozinho, e
       * a tela dizia no comentario que a ordem era por `dueAt`. Duas coisas
       * quebravam:
       *
       *   1. A tela escolhe a fatura em aberto MAIS ANTIGA -- a que a
       *      recepcao precisa resolver agora -- pegando a ultima da lista.
       *      Ordenado por competencia, uma fatura reaberta de competencia
       *      anterior com vencimento posterior aparecia como "a de agora".
       *   2. Duas faturas da MESMA competencia (o que cancelar-e-reemitir
       *      produz) empatavam, e o desempate caia na ordem FISICA do
       *      Postgres, que muda depois de qualquer UPDATE.
       *
       * A listagem transversal (`listar-invoices.use-case.ts`) e a lista de
       * alunos (`student.repository.ts`) ja ordenavam assim; esta era a que
       * faltava.
       */
      orderBy: [{ dueAt: 'desc' }, { id: 'desc' }],
    });

    return { timezone: aluno.gymUnit.timezone, invoices };
  }

  /**
   * Timeline financeira da invoice -- a auditoria da Slice 2.1.
   *
   * Junta o que aconteceu com o dinheiro: abertura, pagamento e credito
   * gerado. E o controle DETECTIVO que substituiu a dupla permissao
   * (ADR-027): sem esta leitura, o registro manual inflado nao teria onde
   * ser percebido.
   */
  async timelineDaInvoice(
    contexto: TenantContext,
    invoiceId: string,
  ): Promise<InvoiceComTimeline | null> {
    return this.db.invoice.findFirst({
      where: { id: invoiceId, tenantId: contexto.tenantId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'asc' } },
        attempts: { orderBy: { requestedAt: 'asc' } },
      },
    });
  }

  /**
   * A tentativa E do aluno? Confere pela INVOICE, nao pelo pagamento.
   *
   * Existe para o totem (F52): la quem consulta e o proprio aluno numa
   * sessao efemera, e `ConsultarTentativaUseCase` escopa so por tenant --
   * correto no balcao, onde o operador e autorizado sobre qualquer aluno.
   * Sem este filtro, uma sessao valida no totem observaria a tentativa de
   * qualquer aluno do tenant chutando UUID.
   *
   * Pela invoice porque `Payment` so nasce quando o webhook confirma: amarrar
   * no pagamento deixaria justamente a janela do QR aberto sem checagem.
   */
  async buscarTentativaDoAluno(
    contexto: TenantContext,
    studentId: string,
    paymentAttemptId: string,
  ): Promise<{ id: string } | null> {
    return this.db.paymentAttempt.findFirst({
      where: {
        id: paymentAttemptId,
        tenantId: contexto.tenantId,
        invoice: { studentId, tenantId: contexto.tenantId },
      },
      select: { id: true },
    });
  }

  /**
   * O pagamento E do aluno? Mesmo raciocinio de `buscarTentativaDoAluno`,
   * pelo lado do `Payment` -- usado pela F25 antes de emitir recibo mobile.
   * Sem isso, uma sessao mobile valida emitiria recibo de qualquer pagamento
   * do tenant trocando um UUID.
   */
  async buscarPagamentoDoAluno(
    contexto: TenantContext,
    studentId: string,
    paymentId: string,
  ): Promise<{ id: string } | null> {
    return this.db.payment.findFirst({
      where: {
        id: paymentId,
        tenantId: contexto.tenantId,
        invoice: { studentId, tenantId: contexto.tenantId },
      },
      select: { id: true },
    });
  }

  /**
   * Proximo numero de invoice do tenant.
   *
   * Mesmo padrao de `StudentRepository.proximaMatricula`, e pelas mesmas
   * razoes: `COUNT(*) + 1` reusa numero depois de cancelamento, e
   * `SEQUENCE` do Postgres e global -- o tenant B veria o volume do A.
   */
  private async proximoNumero(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO invoice_sequences (tenant_id, next_value, updated_at)
      VALUES (${tenantId}::uuid, 1, now())
      ON CONFLICT (tenant_id) DO NOTHING
    `;

    const travadas = await tx.$queryRaw<{ next_value: number }[]>`
      SELECT next_value FROM invoice_sequences
      WHERE tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    const sequencial = travadas[0]?.next_value ?? 1;

    await tx.$executeRaw`
      UPDATE invoice_sequences
      SET next_value = ${sequencial + 1}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
    `;

    return sequencial;
  }

  /**
   * Evento de dominio na MESMA transacao da mudanca de estado.
   *
   * INV-084 / regra de arquitetura 5 (transactional outbox): nada de
   * publicar antes de commitar.
   */
  private async publicarEvento(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    dados: {
      invoiceId: string;
      eventType: string;
      payload: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        tenantId: contexto.tenantId,
        eventType: dados.eventType,
        aggregateType: 'Invoice',
        aggregateId: dados.invoiceId,
        payload: dados.payload,
      },
    });
  }

  /** Mesma query de `OperationsRepository.listarTenantsAtivos` (F11) --
   * duplicada aqui, e nao importada do modulo de operations, para nao
   * acoplar dois modulos sem relacao de dominio por uma consulta de uma
   * linha. */
  async listarTenantsAtivos(): Promise<string[]> {
    const tenants = await this.db.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    return tenants.map((t) => t.id);
  }
}

export type InvoiceComItens = Prisma.InvoiceGetPayload<{
  include: { items: true; payments: true };
}>;

export type InvoiceComTimeline = Prisma.InvoiceGetPayload<{
  include: { items: true; payments: true; attempts: true };
}>;

/** Resposta de `GET /students/:id/invoices` -- fuso da unidade do aluno junto das faturas. */
export interface InvoicesDoAlunoComFuso {
  timezone: string;
  invoices: InvoiceComItens[];
}
