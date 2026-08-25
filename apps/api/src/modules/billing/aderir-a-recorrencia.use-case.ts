import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { validarAdesao } from './domain/assinatura-mensal.js';
import { precoVigenteEm } from './domain/dinheiro.js';
import { ErroDoProvedor, PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.port.js';
import { ProviderAccountResolver } from './provider/provider-account.resolver.js';

/**
 * Adesao do aluno a cobranca recorrente. `SPEC-056` 2.2; ADR-043, Decisao 2.
 *
 * INSTALA A RECORRENCIA UMA VEZ -- e o unico lugar do sistema que chama
 * `createTokenizedSubscription`. Cobrar invoice NAO passa por aqui: isso e
 * `chargeTokenizedPayment`, e confundir os dois foi o defeito que a Decisao 5
 * do ADR-043 achou (doze mensalidades viravam doze calendarios vivos).
 *
 * O QUE A ADESAO **NAO** FAZ: nao cobra nada agora, nao gera invoice, nao
 * muda o status da assinatura. Ela registra que existe autorizacao e um
 * calendario instalado no provedor. Quem cobra continua sendo o ciclo do
 * ArenaHub -- o calendario, o valor e a carencia nunca sairam daqui.
 */

export class AssinaturaNaoEncontradaParaAdesaoError extends ErroDeDominio {
  constructor() {
    super('SUBSCRIPTION_NOT_FOUND', 404, 'Assinatura nao encontrada');
  }
}

export class ConfiguracaoFinanceiraAusenteParaAdesaoError extends ErroDeDominio {
  constructor() {
    super(
      'BILLING_SETTINGS_MISSING',
      409,
      'Configuracao financeira do tenant ausente; defina o ciclo antes de aderir',
    );
  }
}

export class AdesaoJaEmAndamentoError extends ErroDeDominio {
  constructor() {
    /*
     * 409 e nao 500: nao ha nada de errado com o pedido -- outra requisicao
     * ja instalou a recorrencia. 500 mandaria a recepcao clicar de novo, que
     * e exatamente o que nao pode acontecer com dinheiro.
     */
    super(
      'RECURRENCE_ALREADY_ACTIVE',
      409,
      'Esta assinatura ja tem cobranca recorrente ativa',
    );
  }
}

export interface RecorrenciaInstalada {
  subscriptionId: string;
  externalSubscriptionId: string;
  /** Valor que sera cobrado por ciclo, no preco vigente hoje. */
  amountMinor: number;
  currency: string;
  /** Dia do mes do vencimento, do `BillingSettings`. */
  dueDay: number;
}

@Injectable()
export class AderirARecorrenciaUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly contas: ProviderAccountResolver,
    @Inject(PAYMENT_PROVIDER) private readonly provedor: PaymentProvider,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      /** Aceite EXPLICITO do aluno, colhido na tela. */
      aceitouRecorrencia: boolean;
      /** Quem operou a adesao. */
      actorId: string;
      /** O "agora" entra por parametro (`CLAUDE.md`). */
      emQue: Date;
    },
  ): Promise<RecorrenciaInstalada> {
    const assinatura = await this.db.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: {
        plan: { include: { prices: true } },
        student: { select: { cpf: true } },
      },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaParaAdesaoError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteParaAdesaoError();
    }

    const metodo = await this.db.paymentMethod.findFirst({
      where: {
        tenantId: contexto.tenantId,
        studentId: assinatura.studentId,
        status: 'ACTIVE',
        isDefault: true,
      },
      select: { externalTokenId: true },
    });

    const preco = precoVigenteEm(assinatura.plan.prices, entrada.emQue);

    validarAdesao({
      modalidadeDoPlano: assinatura.plan.billingMode,
      planoTemPrecoVigente: preco !== undefined,
      cpfDoAluno: assinatura.student.cpf,
      temCartaoAtivo: metodo !== null,
      jaAderiu: assinatura.externalSubscriptionId !== null,
      aceitouRecorrencia: entrada.aceitouRecorrencia,
      statusDaAssinatura: assinatura.status,
    });

    /*
     * `validarAdesao` ja garantiu os dois, mas o TypeScript nao sabe disso --
     * e um `!` calaria o compilador sem provar nada. Estes ifs sao a prova
     * que o narrowing exige, nao checagem redundante.
     */
    if (preco === undefined || metodo === null) {
      throw new AdesaoJaEmAndamentoError();
    }

    const conta = await this.contas.resolver(contexto, 'CARD');

    /*
     * A CHAVE E A ASSINATURA, nao uma contagem.
     *
     * A F53 cobrou o aluno em dobro porque a chave derivava de um COUNT, e
     * contagem muda entre a leitura e a escrita. Aqui a chave e estavel por
     * construcao: uma assinatura tem UMA recorrencia, entao reenviar a mesma
     * adesao devolve o MESMO `externalSubscriptionId` do provedor em vez de
     * instalar o segundo calendario.
     */
    const idempotencyKey = `sub:${assinatura.id}`;

    const recorrencia = await this.provedor.createTokenizedSubscription({
      externalAccountId: conta.externalAccountId,
      cardToken: metodo.externalTokenId,
      amountMinor: preco.amountMinor,
      currency: preco.currency,
      idempotencyKey,
    });

    /*
     * ESCRITA CONDICIONADA A `externalSubscriptionId: null`.
     *
     * Duas adesoes simultaneas passam as duas pela validacao (leram antes de
     * qualquer escrita) e chamam o provedor -- que, pela chave idempotente,
     * devolve o MESMO id para ambas. Quem perde a corrida bate aqui: o
     * `updateMany` filtra por nulo e afeta ZERO linhas, e vira 409 em vez de
     * sobrescrever calado. Um `if (jaAderiu)` antes do update perderia
     * exatamente esta janela.
     */
    const gravado = await this.db.subscription.updateMany({
      where: {
        id: assinatura.id,
        tenantId: contexto.tenantId,
        externalSubscriptionId: null,
      },
      data: {
        externalSubscriptionId: recorrencia.externalSubscriptionId,
        recurrenceConsentAt: entrada.emQue,
        recurrenceConsentActorId: entrada.actorId,
      },
    });

    if (gravado.count === 0) {
      /*
       * O provedor ja instalou (ou devolveu) a recorrencia, e nao ha linha
       * para gravar. NAO se cancela no provedor aqui: pela chave idempotente
       * o id e o MESMO que a requisicao vencedora gravou, e cancelar mataria
       * a recorrencia legitima dela.
       */
      throw new AdesaoJaEmAndamentoError();
    }

    return {
      subscriptionId: assinatura.id,
      externalSubscriptionId: recorrencia.externalSubscriptionId,
      amountMinor: preco.amountMinor,
      currency: preco.currency,
      dueDay: configuracao.dueDay,
    };
  }
}

export { ErroDoProvedor };
