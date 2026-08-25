import { Injectable, Logger } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository } from './billing.repository.js';
import {
  CobrancaEsgotadaError,
  CobrancaJaEmAndamentoError,
  CobrarAssinaturaNoCartaoUseCase,
} from './cobrar-assinatura-no-cartao.use-case.js';
import { competenciaDe } from './domain/ciclo-de-cobranca.js';
import { ErroDoProvedor } from './provider/payment-provider.port.js';

/**
 * Ciclo mensal das assinaturas: GERA a invoice do periodo e COBRA sozinho.
 * `SPEC-056` 5.3; ADR-043, Decisao 2.
 *
 * E o que faz "assinatura" ser assinatura -- sem ele a modalidade so teria o
 * nome, e alguem ainda precisaria cobrar a cada mes.
 *
 * NADA DE CALENDARIO NOVO AQUI. A competencia, o vencimento e a carencia saem
 * de `ciclo-de-cobranca.ts`; a invoice sai de `BillingRepository`; o retry sai
 * de `retry-de-cobranca.ts` via `CobrarAssinaturaNoCartaoUseCase`. Este caso
 * de uso e um LACO sobre quem tem recorrencia instalada -- reimplementar
 * qualquer uma dessas contas criaria a segunda fonte de verdade que a Decisao
 * 2 recusou ao dispensar o Subscriptions Engine da Getnet.
 *
 * REEXECUTAVEL, como o job de vencimento (`M2-FR-013`): rodar duas vezes tem
 * o efeito de rodar uma. A garantia nao esta num `if` daqui -- esta em INV-066
 * (`(tenant, assinatura, competencia)` unico), que faz a segunda geracao
 * devolver a MESMA invoice, e no indice parcial de cobranca em voo, que faz a
 * segunda cobranca ser recusada pelo banco.
 */

export interface ResultadoDoCiclo {
  /** Assinaturas com recorrencia instalada consideradas nesta execucao. */
  readonly assinaturasConsideradas: number;
  /** Invoices abertas AGORA. Reexecucao no mesmo mes devolve zero. */
  readonly invoicesGeradas: number;
  /** Cobrancas efetivamente disparadas no provedor. */
  readonly cobrancasDisparadas: number;
  /**
   * Assinaturas que o ciclo pulou, com o motivo. NUNCA silencioso: fatia que
   * limita cobertura e nao diz o que ficou de fora e lida como "cobrou
   * todo mundo".
   */
  readonly puladas: readonly { subscriptionId: string; motivo: string }[];
}

/**
 * Status de assinatura que o ciclo cobra.
 *
 * `PAST_DUE` ENTRA: quem esta em atraso e exatamente quem se quer cobrar --
 * tirar a assinatura atrasada do ciclo a deixaria atrasada para sempre.
 */
const STATUS_COBRAVEIS = ['ACTIVE', 'PAST_DUE'] as const;

/**
 * Status de invoice que aceitam cobranca.
 *
 * `OVERDUE` e o nome do vencido no `InvoiceStatus` -- NAO `PAST_DUE`, que e do
 * lado da ASSINATURA. Os dois vocabularios convivem no schema, e trocar um
 * pelo outro pularia justamente a invoice vencida, que e a que mais precisa
 * ser cobrada. O compilador pegou; um `string` nao teria pegado.
 */
const INVOICE_COBRAVEL = ['OPEN', 'OVERDUE'] as const;

@Injectable()
export class RodarCicloDeAssinaturasUseCase {
  private readonly log = new Logger(RodarCicloDeAssinaturasUseCase.name);

  constructor(
    private readonly db: PrismaService,
    private readonly repositorio: BillingRepository,
    private readonly cobrar: CobrarAssinaturaNoCartaoUseCase,
  ) {}

  /** O "agora" entra por parametro (`CLAUDE.md`): o job roda por agendador. */
  async executar(contexto: TenantContext, agora: Date): Promise<ResultadoDoCiclo> {
    const competencia = competenciaDe(agora);

    /*
     * `externalSubscriptionId: { not: null }` E O FILTRO QUE IMPORTA.
     *
     * Cobrar quem NAO aderiu seria debitar cartao sem autorizacao -- o pior
     * defeito que este arquivo pode ter. Assinatura de plano AVULSO e
     * assinatura de plano ASSINATURA sem adesao ficam de fora pelo mesmo
     * criterio, e o criterio e o consentimento, nao a modalidade do plano:
     * plano que virou ASSINATURA depois da venda nao autoriza retroativamente
     * ninguem.
     */
    const assinaturas = await this.db.subscription.findMany({
      where: {
        tenantId: contexto.tenantId,
        externalSubscriptionId: { not: null },
        status: { in: [...STATUS_COBRAVEIS] },
      },
      select: { id: true, status: true },
    });

    const puladas: { subscriptionId: string; motivo: string }[] = [];
    let invoicesGeradas = 0;
    let cobrancasDisparadas = 0;

    for (const assinatura of assinaturas) {
      /*
       * EM SERIE, nao em paralelo, e de proposito.
       *
       * Cada iteracao fala com o provedor. Disparar tudo junto multiplicaria
       * a chance de estouro de limite e, num erro de infraestrutura, deixaria
       * um numero imprevisivel de cobrancas em voo -- justamente o estado
       * mais caro de reconciliar depois. O laco e mensal e a base tem
       * centenas de alunos, nao milhoes.
       *
       * ponytail: serial; paralelizar por lotes se o ciclo passar de minutos.
       */
      const existente = await this.db.invoice.findUnique({
        where: {
          tenantId_subscriptionId_billingPeriod: {
            tenantId: contexto.tenantId,
            subscriptionId: assinatura.id,
            billingPeriod: competencia,
          },
        },
        select: { id: true, status: true },
      });

      let invoiceId: string;

      if (existente) {
        /*
         * Invoice ja liquidada nao se cobra de novo (`M2-BR-002`: invoice
         * paga nao volta a aberta). `PAID` e os terminais saem aqui.
         */
        if (!INVOICE_COBRAVEL.some((cobravel) => cobravel === existente.status)) {
          puladas.push({
            subscriptionId: assinatura.id,
            motivo: `invoice do periodo em ${existente.status}`,
          });
          continue;
        }

        invoiceId = existente.id;
      } else {
        try {
          const invoice = await this.repositorio.abrirInvoiceDoPeriodo(contexto, {
            subscriptionId: assinatura.id,
            emQue: agora,
          });
          invoiceId = invoice.id;
          invoicesGeradas += 1;
        } catch (erro) {
          /*
           * Plano sem preco vigente, configuracao ausente: o ciclo NAO para
           * por causa de uma assinatura. Parar deixaria todo mundo depois
           * dela sem cobranca no mes, e o motivo ficaria escondido num log de
           * excecao -- e por isso que vai para `puladas`, que sobe na
           * resposta.
           */
          puladas.push({ subscriptionId: assinatura.id, motivo: motivoDe(erro) });
          continue;
        }
      }

      try {
        await this.cobrar.executar(contexto, { invoiceId, agora });
        cobrancasDisparadas += 1;
      } catch (erro) {
        /*
         * TRES FALHAS ESPERADAS, e nenhuma delas e defeito deste laco:
         *
         * - `CobrancaEsgotadaError`: o retry do tenant acabou, ou a recusa foi
         *   permanente. Quem trata daqui em diante e a regua de inadimplencia
         *   da F15 -- sem caminho novo (`SPEC-056` 5.4).
         * - `CobrancaJaEmAndamentoError`: outra execucao (ou a recepcao) ja
         *   colocou esta invoice em voo. Reexecucao concorrente do job cai
         *   aqui, e e o comportamento certo.
         * - `ErroDoProvedor`: fora do ar, timeout. A proxima execucao tenta.
         */
        if (
          erro instanceof CobrancaEsgotadaError ||
          erro instanceof CobrancaJaEmAndamentoError ||
          erro instanceof ErroDoProvedor
        ) {
          puladas.push({ subscriptionId: assinatura.id, motivo: motivoDe(erro) });
          continue;
        }

        throw erro;
      }
    }

    if (puladas.length > 0) {
      /*
       * Log do que ficou de fora, com CONTAGEM e ids -- nunca com dado do
       * aluno. Um ciclo que pula metade da base em silencio parece um ciclo
       * que cobrou todo mundo.
       */
      this.log.warn(
        `ciclo de assinaturas: ${puladas.length} de ${assinaturas.length} puladas`,
      );
    }

    return {
      assinaturasConsideradas: assinaturas.length,
      invoicesGeradas,
      cobrancasDisparadas,
      puladas,
    };
  }
}

/** Codigo estavel quando existe; mensagem generica quando nao. Nunca PII. */
function motivoDe(erro: unknown): string {
  if (erro !== null && typeof erro === 'object' && 'code' in erro) {
    // `'code' in erro` ja estreita o tipo -- assercao aqui seria redundante.
    const { code: codigo } = erro;

    if (typeof codigo === 'string') {
      return codigo;
    }
  }

  return 'UNEXPECTED';
}
