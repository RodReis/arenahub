import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository, PlanoSemPrecoVigenteError } from '../billing/billing.repository.js';
import { competenciaDe } from '../billing/domain/ciclo-de-cobranca.js';
import { precoVigenteEm } from '../billing/domain/dinheiro.js';
import { StudentRepository } from '../students/student.repository.js';
import { fimDaDiaria, haJanelaAteOFimDoDia } from './domain/diaria.js';
import { MembershipRepository, PlanoNaoEncontradoError } from './membership.repository.js';

export class PlanoDeDiariaInvalidoError extends ErroDeDominio {
  constructor() {
    super('DAY_PASS_PLAN_INVALID', 422, 'O plano nao e uma diaria ativa e vendavel hoje');
  }
}

export class DiariaFechadaHojeError extends ErroDeDominio {
  constructor() {
    super(
      'DAY_PASS_CLOSED_TODAY',
      422,
      'O plano nao tem horario de acesso restante hoje na unidade do aluno',
    );
  }
}

export class PrecoDaDiariaMudouError extends ErroDeDominio {
  constructor() {
    super('PRICE_CHANGED', 409, 'O preco da diaria mudou; recarregue e confira o valor');
  }
}

export interface EntradaDeVendaDeDiaria {
  readonly studentId: string;
  readonly planId: string;
  readonly channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
  /** O que a tela mostrou: conferencia otimista, nao autoridade (mesma ideia do lote). */
  readonly expectedTotalMinor: number;
  /** Ausente = recebeu exatamente o preco. Maior vira credito; menor e recusado. */
  readonly receivedAmountMinor?: number | undefined;
}

export interface DiariaVendida {
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Venda de diaria no balcao -- F86, `SPEC-086`.
 *
 * UMA transacao: assinatura `PENDING` + direito `SCHEDULED`, invoice com
 * vencimento na compra e pagamento manual. E o PAGAMENTO que promove os dois
 * para `ACTIVE` -- nao existe acesso sem pagamento registrado, e qualquer falha
 * desfaz tudo.
 *
 * Esta classe so ORQUESTRA: o calculo do dia e puro (`domain/diaria.ts`), a
 * trava do aluno e a criacao do direito moram em `MembershipRepository`, e a
 * invoice e o pagamento sao os de sempre em `BillingRepository`. Nada de regra
 * financeira reimplementada aqui.
 */
@Injectable()
export class VenderDiariaUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly membership: MembershipRepository,
    private readonly billing: BillingRepository,
    private readonly alunos: StudentRepository,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: EntradaDeVendaDeDiaria,
    correlationId: string,
    agora: Date,
  ): Promise<DiariaVendida> {
    // Tudo que pode recusar a venda roda ANTES da transacao: nao ha o que desfazer.
    const plano = await this.membership.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();

    const dentroDaValidadeDeVenda =
      (plano.salesStartAt === null || agora >= plano.salesStartAt) &&
      (plano.salesEndAt === null || agora < plano.salesEndAt);

    if (plano.billingMode !== 'DIARIA' || !plano.isActive || !dentroDaValidadeDeVenda) {
      throw new PlanoDeDiariaInvalidoError();
    }

    const preco = precoVigenteEm(plano.prices, competenciaDe(agora));
    if (!preco) throw new PlanoSemPrecoVigenteError();
    if (preco.amountMinor !== entrada.expectedTotalMinor) throw new PrecoDaDiariaMudouError();

    const unidade = await this.alunos.unidadeDeOrigem(contexto, entrada.studentId);
    if (!unidade) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');

    if (!haJanelaAteOFimDoDia(agora, unidade.timezone, unidade.gymUnitId, plano.accessWindows)) {
      throw new DiariaFechadaHojeError();
    }

    const endsAt = fimDaDiaria(agora, unidade.timezone);

    return this.db.$transaction(async (tx) => {
      const { subscription } = await this.membership.criarDiariaPendente(
        tx,
        contexto,
        { studentId: entrada.studentId, plano, startsAt: agora, endsAt },
        correlationId,
      );

      const invoice = await this.billing.abrirInvoiceDoPeriodo(
        contexto,
        {
          subscriptionId: subscription.id,
          emQue: agora,
          // Vence na compra e bloqueia no fim do dia: `dueDay` e carencia sao do ciclo mensal.
          vencimento: { dueAt: agora, blockAt: endsAt },
        },
        tx,
      );

      const pagamento = await this.billing.registrarPagamentoManual(
        contexto,
        {
          invoiceId: invoice.id,
          amountMinor: entrada.receivedAmountMinor ?? invoice.totalMinor,
          reason: 'Diaria vendida no balcao',
          paidAt: agora,
          receivedVia: entrada.channel,
        },
        correlationId,
        tx,
      );

      return {
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        paymentId: pagamento.id,
        startsAt: agora,
        endsAt,
      };
    });
  }
}
