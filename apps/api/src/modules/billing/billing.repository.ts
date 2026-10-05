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
import {
  abrirInvoice,
  aplicarPagamento,
  corrigirValorDaInvoice,
  podeTransicionar,
  TransicaoDeInvoiceConcorrenteError,
  validarStatusParaCorrecao,
} from './domain/invoice.js';

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

export class InvoiceComMaisDeUmItemError extends ErroDeDominio {
  constructor() {
    super(
      'INVOICE_MULTI_ITEM_NOT_SUPPORTED',
      422,
      'Correcao de valor so suporta invoice com exatamente um item',
    );
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
    tx?: Prisma.TransactionClient,
  ): Promise<Invoice> {
    const competencia = competenciaDe(entrada.emQue);

    // As duas leituras iniciais ja rodavam fora da transacao original; um
    // `tx` recebido de fora (Task 3, lote) so precisa ser usado aqui tambem
    // para nao abrir uma segunda conexao dentro de uma transacao alheia.
    const cliente = tx ?? this.db;

    const assinatura = await cliente.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await cliente.billingSettings.findUnique({
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

    const executar = async (tx: Prisma.TransactionClient): Promise<Invoice> => {
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
    };

    // `tx` vindo de fora (Task 3, lote) participa da transacao do chamador;
    // sem ele, abre a propria -- caminho existente preservado.
    return tx ? executar(tx) : this.db.$transaction(executar);
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
    entrada: {
      invoiceId: string;
      amountMinor: number;
      reason: string;
      paidAt: Date;
      receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
      batchId?: string;
    },
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Payment> {
    const cliente = tx ?? this.db;

    const invoice = await cliente.invoice.findFirst({
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

    const executar = async (tx: Prisma.TransactionClient): Promise<Payment> => {
      /**
       * Transicao CONDICIONADA, nao `update` incondicional (F83, issue
       * #458): duas chamadas concorrentes sobre a MESMA invoice -- um
       * recebimento avulso e um lote, por exemplo -- podem ambas ler
       * `OPEN` e ambas tentar pagar. O `updateMany` com filtro de status
       * garante que so UMA transiciona para `PAID`; a outra recebe
       * `count !== 1` e falha aqui, antes de criar qualquer `Payment`.
       *
       * A garantia real e "a invoice transiciona para PAID uma vez so" --
       * NAO "no maximo 1 Payment CONFIRMED por invoice" (esse invariante e
       * falso por desenho: o webhook PIX grava um segundo Payment numa
       * invoice ja PAID e manda o valor para credito).
       */
      const transicao = await tx.invoice.updateMany({
        where: { id: invoice.id, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
        data: { status: 'PAID', paidAt: entrada.paidAt, version: { increment: 1 } },
      });

      if (transicao.count !== 1) {
        throw new TransicaoDeInvoiceConcorrenteError(invoice.id);
      }

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
          receivedVia: entrada.receivedVia,
          batchId: entrada.batchId ?? null,
        },
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
            receivedVia: entrada.receivedVia,
            batchId: entrada.batchId ?? null,
          },
        },
      });

      await this.ativarDireitoDeAcessoSePendente(tx, {
        tenantId: contexto.tenantId,
        subscriptionId: invoice.subscriptionId,
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoicePaid',
        payload: { paymentId: pagamento.id, method: 'MANUAL' },
      });

      return pagamento;
    };

    return tx ? executar(tx) : this.db.$transaction(executar);
  }

  /**
   * Corrige o valor de uma invoice ainda nao paga (issue #419): 5 alunos
   * pagaram o preco vigente do plano, mas a invoice de set/2026 abriu com o
   * preco antigo (reajuste nao propagado). NAO e edicao livre -- so muda o
   * valor unitario do item unico contra o preco vigente do plano na
   * competencia, e so em invoice OPEN/OVERDUE (`validarStatusParaCorrecao`,
   * INV-069: invoice PAID ja tem dinheiro reconhecido contra o valor
   * anterior).
   *
   * Recusa invoice com mais de um item: hoje toda invoice nasce com
   * exatamente um (`abrirInvoiceDoPeriodo`), e corrigir "o item errado" sem
   * saber qual seria inventar regra de negocio que nao existe.
   */
  async corrigirValorDaInvoice(
    contexto: TenantContext,
    entrada: { invoiceId: string; novoValorUnitarioMinor: number; reason: string },
    correlationId: string,
  ): Promise<Invoice> {
    const invoice = await this.db.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
      include: { items: true },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaError();
    }

    validarStatusParaCorrecao(invoice.status);

    if (invoice.items.length !== 1) {
      throw new InvoiceComMaisDeUmItemError();
    }

    const item = invoice.items[0]!;
    const totais = corrigirValorDaInvoice({
      quantity: item.quantity,
      novoValorUnitarioMinor: entrada.novoValorUnitarioMinor,
      discountMinor: invoice.discountMinor,
    });

    return this.db.$transaction(async (tx) => {
      await tx.invoiceItem.update({
        where: { id: item.id },
        data: {
          unitAmountMinor: entrada.novoValorUnitarioMinor,
          totalMinor: entrada.novoValorUnitarioMinor * item.quantity,
        },
      });

      const atualizada = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          subtotalMinor: totais.subtotalMinor,
          totalMinor: totais.totalMinor,
          version: { increment: 1 },
        },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: invoice.studentId,
          type: 'INVOICE_CORRECTED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: {
            invoiceId: invoice.id,
            deTotalMinor: invoice.totalMinor,
            paraTotalMinor: totais.totalMinor,
            reason: entrada.reason,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.invoice.correct_amount',
          target: 'Invoice',
          targetId: invoice.id,
          correlationId,
          metadata: {
            deTotalMinor: invoice.totalMinor,
            paraTotalMinor: totais.totalMinor,
            reason: entrada.reason,
          },
        },
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoiceAmountCorrected',
        payload: { deTotalMinor: invoice.totalMinor, paraTotalMinor: totais.totalMinor },
      });

      return atualizada;
    });
  }

  /**
   * Ultimo elo da cadeia (regra de arquitetura 1, INV-091): assinatura
   * ativa, entitlement ativo. SO PROMOVE O QUE JA ESTAVA ESPERANDO --
   * assinatura ja `ACTIVE` nao e tocada, e entitlement `REVOKED` nao
   * ressuscita por pagamento (revogacao tem motivo proprio).
   *
   * Compartilhado entre pagamento manual (aqui) e webhook de provedor
   * (`ProcessarWebhookDePagamentoUseCase`). FIX: antes de 23/09/2026, so o
   * webhook promovia -- pagamento em dinheiro/PIX reconhecido na recepcao
   * fechava a invoice mas deixava o aluno "pagando e batendo na porta
   * fechada" (comentario original do use-case do webhook, que descrevia
   * exatamente o sintoma sem perceber que o caminho manual tinha o mesmo
   * buraco).
   *
   * Nao CRIA entitlement -- quem cria e a matricula (F7/F10), com o
   * snapshot de politica do plano. Criar aqui exigiria montar snapshot
   * dentro do financeiro, que e o que a regra de arquitetura no 9 proibe.
   */
  async ativarDireitoDeAcessoSePendente(
    tx: Prisma.TransactionClient,
    dados: { tenantId: string; subscriptionId: string },
  ): Promise<void> {
    await tx.subscription.updateMany({
      where: {
        id: dados.subscriptionId,
        tenantId: dados.tenantId,
        status: { in: ['PENDING', 'PAST_DUE'] },
      },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });

    await tx.entitlement.updateMany({
      where: {
        subscriptionId: dados.subscriptionId,
        tenantId: dados.tenantId,
        status: { in: ['SCHEDULED', 'SUSPENDED'] },
      },
      data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
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
      include: {
        items: true,
        /*
         * A GRADE nunca mostra pagamento CANCELADO (F85): para a recepcao o
         * lancamento errado "some" e a fatura reaparece em aberto. A linha
         * continua no banco, com autor e motivo, e `timelineDaInvoice` (a
         * trilha de auditoria) segue devolvendo tudo.
         *
         * `orderBy` explicito: sem ele a ordem das linhas filhas muda depois
         * de um UPDATE -- justamente o que acabamos de fazer no pagamento.
         */
        payments: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } },
      },
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
   *
   * Semente da linha nova usa `max(number)+1` da propria `invoices`, nao `1`
   * fixo -- tenant com invoice gravada por fora deste metodo (seed, import)
   * tinha a sequencia nascendo atras do numero ja existente e colidia na
   * unique constraint (issue #462).
   */
  private async proximoNumero(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO invoice_sequences (tenant_id, next_value, updated_at)
      SELECT ${tenantId}::uuid, COALESCE(MAX(number), 0) + 1, now()
      FROM invoices WHERE tenant_id = ${tenantId}::uuid
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
