import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { ProcessarWebhookDePagamentoUseCase } from './processar-webhook-de-pagamento.use-case.js';

/**
 * Resolucao de divergencia de conciliacao. F16, `M2-FR-020`, `M2-AC-010`.
 *
 * O ACEITE DA FATIA E LITERAL: "operador resolve divergencia sem editar banco
 * e sem duplicar efeito financeiro". Por isso a lista de comandos e FECHADA --
 * um comando generico de correcao seria o mesmo `UPDATE` manual que este
 * caminho existe para tornar desnecessario, so que por dentro da aplicacao,
 * parecendo seguro.
 *
 * OS DOIS COMANDOS, e por que sao so dois:
 *
 * - `REPROCESS_PROVIDER_EVENT` -- o evento chegou, ficou guardado e nao foi
 *   aplicado. Reprocessa pelo MESMO caminho idempotente do webhook, nunca por
 *   um atalho de escrita: se o caminho normal nao consegue aplicar o evento,
 *   forcar por fora esconderia o defeito em vez de corrigi-lo.
 *
 * - `ACCEPT_DOCUMENTED_DIFFERENCE` -- a diferenca e real, explicada e aceita
 *   (tarifa do provedor, retencao). NAO MOVE DINHEIRO: registra que alguem
 *   olhou, decidiu e assinou.
 *
 * O QUE NAO ESTA AQUI, E POR QUE: `CREATE_COMPENSATING_MOVEMENT` e
 * `LINK_EXISTING` aparecem no plano de apoio da Slice. O primeiro cria
 * lancamento financeiro a partir da tela de conciliacao -- e um caminho de
 * escrita de dinheiro que nenhum documento normativo autoriza, e que
 * contornaria a propria cadeia `Pagamento → Invoice → Entitlement`. O segundo
 * casa manualmente dois movimentos, o que reintroduz por decisao humana
 * exatamente o casamento frouxo que a matriz deterministica recusa. Ambos
 * ficam fora, registrados no PR.
 */

export class DivergenciaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('RECONCILIATION_ITEM_NOT_FOUND', 404, 'divergencia nao encontrada');
  }
}

export class DivergenciaJaResolvidaError extends ErroDeDominio {
  constructor() {
    /**
     * 409 e nao 422: o pedido esta bem formado, o item e que ja foi tratado.
     * A tela precisa distinguir "voce errou" de "outra pessoa chegou antes".
     */
    super('RECONCILIATION_ITEM_ALREADY_RESOLVED', 409, 'esta divergencia ja foi resolvida');
  }
}

export class ComandoInvalidoParaDivergenciaError extends ErroDeDominio {
  constructor(comando: string, status: string) {
    super(
      'RECONCILIATION_COMMAND_NOT_APPLICABLE',
      409,
      `o comando ${comando} nao se aplica a uma divergencia em ${status}`,
    );
  }
}

export class EventoDoProvedorAusenteError extends ErroDeDominio {
  constructor() {
    super(
      'PROVIDER_EVENT_NOT_FOUND',
      409,
      'nao ha evento do provedor guardado para reprocessar; consulte o status pela API',
    );
  }
}

export type ComandoDeResolucao = 'REPROCESS_PROVIDER_EVENT' | 'ACCEPT_DOCUMENTED_DIFFERENCE';

/**
 * Que comando cabe em que divergencia.
 *
 * `MISSING_EXTERNAL` NAO ACEITA REPROCESSAMENTO, e isso nao e omissao: nao ha
 * evento nenhum para reprocessar -- o provedor e que nao reportou. O que cabe
 * ali e aceitar a diferenca documentada, depois de conferir se a liquidacao
 * caiu fora da janela.
 */
const COMANDOS_POR_STATUS: Readonly<Record<string, readonly ComandoDeResolucao[]>> = {
  MISSING_INTERNAL: ['REPROCESS_PROVIDER_EVENT', 'ACCEPT_DOCUMENTED_DIFFERENCE'],
  MISSING_EXTERNAL: ['ACCEPT_DOCUMENTED_DIFFERENCE'],
  AMOUNT_MISMATCH: ['ACCEPT_DOCUMENTED_DIFFERENCE'],
};

export interface DivergenciaResolvida {
  readonly itemId: string;
  readonly comando: ComandoDeResolucao;
  /** O reprocessamento chegou a aplicar o evento? Nulo nos demais comandos. */
  readonly eventoAplicado: boolean | null;
}

@Injectable()
export class ResolverDivergenciaUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly webhook: ProcessarWebhookDePagamentoUseCase,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: {
      itemId: string;
      comando: ComandoDeResolucao;
      reason: string;
      agora: Date;
    },
    correlationId: string,
  ): Promise<DivergenciaResolvida> {
    const item = await this.db.reconciliationItem.findFirst({
      where: { id: entrada.itemId, tenantId: contexto.tenantId },
      select: { id: true, status: true, externalMovementId: true },
    });

    if (!item) {
      throw new DivergenciaNaoEncontradaError();
    }

    if (item.status === 'RESOLVED' || item.status === 'MATCHED') {
      throw new DivergenciaJaResolvidaError();
    }

    const permitidos = COMANDOS_POR_STATUS[item.status] ?? [];

    if (!permitidos.includes(entrada.comando)) {
      throw new ComandoInvalidoParaDivergenciaError(entrada.comando, item.status);
    }

    let eventoAplicado: boolean | null = null;

    if (entrada.comando === 'REPROCESS_PROVIDER_EVENT') {
      eventoAplicado = await this.reprocessar(contexto, item.externalMovementId);
    }

    await this.db.$transaction(async (tx) => {
      /**
       * `updateMany` com o status no filtro, e nao `update` por id: duas
       * operadoras resolvendo o mesmo item ao mesmo tempo produziriam duas
       * resolucoes, e a segunda sobrescreveria a razao da primeira. Aqui a
       * segunda simplesmente nao encontra o que atualizar.
       */
      const atualizados = await tx.reconciliationItem.updateMany({
        where: { id: item.id, tenantId: contexto.tenantId, status: item.status },
        data: {
          status: 'RESOLVED',
          resolution: entrada.comando,
          resolutionReason: entrada.reason,
          resolvedByUserId: contexto.actorId,
          resolvedAt: entrada.agora,
        },
      });

      if (atualizados.count === 0) {
        throw new DivergenciaJaResolvidaError();
      }

      /**
       * Auditoria da resolucao.
       *
       * INV-126 NAO LISTA "resolucao de divergencia" entre as acoes auditaveis
       * -- mas `M2-FR-020` exige "listar e resolver divergencias COM
       * AUDITORIA", e uma decisao que fecha pendencia financeira sem trilha e
       * exatamente o buraco que o resto do modulo evita. Audito, e registro a
       * lacuna do INV-126 no PR para o Cowork emendar.
       */
      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.reconciliation.resolved',
          target: 'ReconciliationItem',
          targetId: item.id,
          correlationId,
          metadata: {
            comando: entrada.comando,
            statusAnterior: item.status,
            reason: entrada.reason,
            eventoAplicado,
          },
        },
      });
    });

    return { itemId: item.id, comando: entrada.comando, eventoAplicado };
  }

  /**
   * Reprocessa o evento guardado, pelo caminho idempotente de sempre.
   *
   * NAO CHAMA O WEBHOOK COM CORPO CRU: a assinatura ja foi verificada quando o
   * evento chegou, e refazer a verificacao exigiria guardar o corpo bruto e o
   * header -- payload cru retido a mais e superficie de vazamento, e o
   * `MVP-02` §15 pede retencao minima.
   *
   * O que se reprocessa e o EFEITO, e ele e idempotente por construcao
   * (INV-076, INV-086): se o evento ja tiver sido aplicado, nada muda.
   */
  private async reprocessar(
    contexto: TenantContext,
    externalMovementId: string | null,
  ): Promise<boolean> {
    if (!externalMovementId) {
      throw new EventoDoProvedorAusenteError();
    }

    const movimento = await this.db.externalMovement.findFirst({
      where: { tenantId: contexto.tenantId, externalMovementId },
      select: { externalPaymentId: true },
    });

    if (!movimento?.externalPaymentId) {
      throw new EventoDoProvedorAusenteError();
    }

    const evento = await this.db.providerEvent.findFirst({
      where: {
        tenantId: contexto.tenantId,
        externalPaymentId: movimento.externalPaymentId,
        processedAt: null,
      },
      orderBy: { occurredAt: 'asc' },
      select: { id: true },
    });

    /**
     * Sem evento pendente, o reprocessamento nao tem o que fazer -- e dizer
     * isso e melhor que "resolvido" silencioso: o operador precisa saber que
     * a pendencia continua do lado do provedor, e que o caminho e consultar o
     * status pela API.
     */
    if (!evento) {
      throw new EventoDoProvedorAusenteError();
    }

    return this.webhook.reprocessarEventoGuardado(contexto.tenantId, evento.id);
  }
}
