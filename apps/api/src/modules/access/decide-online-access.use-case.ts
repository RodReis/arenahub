import { Injectable } from '@nestjs/common';
import {
  POLICY_VERSION,
  evaluateAccess,
  type AllowReason,
  type DenyReason,
} from '@arenahub/access-policy';

import type { ContextoDoEdge } from '../edge-auth/edge-auth.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { AccessEventRepository } from './access-event.repository.js';
import { AccessProjectionRepository } from './access-projection.repository.js';
import { LiberacaoFinanceiraUseCase } from '../billing/liberacao-financeira.use-case.js';
import { IdentityResolver } from './identity-resolver.js';

/**
 * Decisao online de acesso -- `M1-FR-019` a `M1-FR-022`.
 *
 * A ordem aqui e a garantia central da fatia: **o evento e gravado ANTES de
 * a resposta sair**. Nao existe caminho em que a catraca receba `ALLOW` sem
 * que a decisao ja esteja no banco. O contrario -- responder e gravar depois
 * -- produziria exatamente a passagem sem registro que o `M1` §3 mede como
 * defeito ("100% das decisoes fisicas possuem `AccessEvent` correlacionavel").
 *
 * A NUVEM NAO COMANDA HARDWARE. Este caso de uso decide e registra; quem
 * aciona a catraca e o Edge, na Task 4. Misturar as duas coisas faria uma
 * falha de rede no meio da resposta virar catraca aberta sem ninguem saber.
 */

export interface ReconhecimentoRecebido {
  deviceId: string;
  externalUserId: string;
  recognitionId: string;
  /** Relogio do EQUIPAMENTO. Evidencia, nao fonte da decisao. */
  recognizedAt: Date;
  /** Confianca do reconhecimento facial, quando o modelo informa. */
  confidence?: number | undefined;
  idempotencyKey: string;
  correlationId: string;
}

export interface DecisaoRespondida {
  accessEventId: string;
  correlationId: string;
  outcome: 'ALLOW' | 'DENY';
  reason: string;
  policyVersion: string;
  validUntil: string | null;
  /** `true` quando a chave ja tinha sido decidida -- retry. */
  replayed: boolean;
}

/**
 * Limite de deriva de relogio aceito no reconhecimento.
 *
 * O plano F9 §1 fixa alerta acima de 30 s. Aqui o valor e maior de proposito:
 * 30 s e o limite para ALERTAR o operador, nao para RECUSAR a pessoa. Negar
 * entrada legitima porque a catraca esta 40 s adiantada seria trocar um
 * problema de infraestrutura por um problema de atendimento.
 *
 * O que a deriva faz e ficar registrada no evento -- e a decisao usa sempre o
 * relogio do servidor.
 */
export const DERIVA_MAXIMA_MS = 5 * 60_000;

@Injectable()
export class DecideOnlineAccessUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly identidades: IdentityResolver,
    private readonly projecao: AccessProjectionRepository,
    private readonly eventos: AccessEventRepository,
    private readonly liberacaoFinanceira: LiberacaoFinanceiraUseCase,
  ) {}

  async executar(
    edge: ContextoDoEdge,
    entrada: ReconhecimentoRecebido,
  ): Promise<DecisaoRespondida> {
    // Relogio do SERVIDOR decide. O do equipamento so vira evidencia -- uma
    // catraca com hora adiantada nao pode esticar a validade de um direito.
    const avaliadoEm = new Date();
    const derivaMs = entrada.recognizedAt.getTime() - avaliadoEm.getTime();

    const identidade = await this.identidades.resolver(
      edge,
      entrada.deviceId,
      entrada.externalUserId,
    );

    // Identidade que nao resolve e DENY registrado, nao erro HTTP. O leitor
    // viu alguem; quem, nao sabemos -- e esse e justamente o evento que
    // interessa investigar depois.
    if (!identidade.resolvida) {
      return this.registrar(edge, entrada, {
        outcome: 'DENY',
        reason: 'NO_ENTITLEMENT',
        entitlementId: null,
        validUntil: null,
        studentId: identidade.studentId ?? null,
        identityId: null,
        deviceId: identidade.deviceId ?? null,
        avaliadoEm,
        derivaMs,
        detalheExtra: { identityResolution: identidade.motivo },
      });
    }

    const entradaDaPolitica = await this.projecao.montarEntrada(
      edge.tenantId,
      edge.gymUnitId,
      identidade.studentId,
      identidade.studentStatus,
      avaliadoEm,
    );

    const decisao = evaluateAccess(entradaDaPolitica);

    /**
     * LIBERACAO FINANCEIRA -- F15, Slice 2.4.
     *
     * DEPOIS DO MOTOR, e so quando a negativa foi por DIVIDA. O motor puro
     * nao consulta banco (ele roda tambem no Edge, sem PostgreSQL), entao a
     * liberacao nao pode entrar nele -- mesma arquitetura de
     * `MANUAL_OVERRIDE`, ADR-024.
     *
     * SO CONVERTE `PAYMENT_OVERDUE`. Uma liberacao financeira nao pode passar
     * por cima de bloqueio administrativo, aluno `BLOCKED` ou horario fora da
     * janela: ela responde por divida, e nada mais. Aplicar antes do motor,
     * ou a qualquer DENY, transformaria a valvula da recepcao em chave-mestra
     * -- e o `M1-BR-006` diz que a politica mais restritiva prevalece.
     */
    if (decisao.outcome === 'DENY' && decisao.reason === 'PAYMENT_OVERDUE') {
      const liberacao = await this.liberacaoFinanceira.liberacaoVigente(
        edge.tenantId,
        identidade.studentId,
        new Date(avaliadoEm),
      );

      if (liberacao) {
        return this.registrar(edge, entrada, {
          outcome: 'ALLOW',
          /**
           * `FINANCIAL_OVERRIDE`, nunca `ACTIVE_ENTITLEMENT`: o direito
           * continua SUSPENSO, e afirmar o contrario gravaria mentira num
           * fato imutavel. Todo relatorio de "acesso por direito valido"
           * teria de lembrar de excluir este caso.
           */
          reason: 'FINANCIAL_OVERRIDE',
          entitlementId: null,
          validUntil: null,
          studentId: identidade.studentId,
          identityId: identidade.identityId,
          deviceId: identidade.deviceId,
          avaliadoEm,
          derivaMs,
          detalheExtra: { financialOverrideId: liberacao.id, overrideReason: liberacao.reason },
        });
      }
    }

    return this.registrar(edge, entrada, {
      outcome: decisao.outcome,
      reason: decisao.reason,
      entitlementId: decisao.outcome === 'ALLOW' ? decisao.entitlementId : null,
      validUntil: decisao.outcome === 'ALLOW' ? new Date(decisao.validUntil) : null,
      studentId: identidade.studentId,
      identityId: identidade.identityId,
      deviceId: identidade.deviceId,
      avaliadoEm,
      derivaMs,
      detalheExtra: {
        // Entrada congelada do motor: e o que torna a decisao AUDITAVEL --
        // sem ela, "por que negou?" so se responde reconstruindo o estado do
        // banco naquele instante, que ja mudou.
        policyInput: {
          localDayOfWeek: entradaDaPolitica.localDayOfWeek,
          localMinuteOfDay: entradaDaPolitica.localMinuteOfDay,
          entitlementCount: entradaDaPolitica.entitlements.length,
          adminBlock: entradaDaPolitica.adminBlock.active,
          studentStatus: entradaDaPolitica.student.status,
        },
      },
    });
  }

  /**
   * Grava evento e outbox NA MESMA TRANSACAO (regra de arquitetura no 5).
   *
   * Publicar antes de commitar produziria evento de acesso que nenhum
   * `AccessEvent` respalda; commitar sem outbox produziria acesso que nenhum
   * consumidor ve. A transacao e o que impede os dois.
   */
  private async registrar(
    edge: ContextoDoEdge,
    entrada: ReconhecimentoRecebido,
    decisao: {
      outcome: 'ALLOW' | 'DENY';
      /**
       * DERIVADO DA FONTE, nao reescrito a mao.
       *
       * Ate a F15 esta era uma uniao literal de sete strings -- uma TERCEIRA
       * copia da lista de razoes, alem de `types.ts` e do enum do Prisma. Ao
       * acrescentar `PAYMENT_OVERDUE` o compilador acusou a copia, que e
       * exatamente o que o comentario do enum no schema pedia para evitar:
       * "espelha `packages/access-policy/src/types.ts`, que e a fonte".
       *
       * Agora a proxima razao entra em UM lugar e o resto acompanha.
       */
      reason: AllowReason | DenyReason;
      entitlementId: string | null;
      validUntil: Date | null;
      studentId: string | null;
      identityId: string | null;
      deviceId: string | null;
      avaliadoEm: Date;
      derivaMs: number;
      detalheExtra: Record<string, unknown>;
    },
  ): Promise<DecisaoRespondida> {
    const { evento, jaExistia } = await this.db.$transaction(async (tx) => {
      const resultado = await this.eventos.append(
        {
          tenantId: edge.tenantId,
          gymUnitId: edge.gymUnitId,
          edgeNodeId: edge.edgeNodeId,
          deviceId: decisao.deviceId,
          studentId: decisao.studentId,
          identityId: decisao.identityId,
          externalUserId: entrada.externalUserId,
          recognitionId: entrada.recognitionId,
          outcome: decisao.outcome,
          reason: decisao.reason,
          entitlementId: decisao.entitlementId,
          validUntil: decisao.validUntil,
          policyVersion: POLICY_VERSION,
          mode: 'ONLINE',
          method: 'FACIAL',
          recognizedAt: entrada.recognizedAt,
          occurredAt: decisao.avaliadoEm,
          correlationId: entrada.correlationId,
          idempotencyKey: entrada.idempotencyKey,
          detail: {
            ...decisao.detalheExtra,
            clockDriftMs: decisao.derivaMs,
            clockDriftExceeded: Math.abs(decisao.derivaMs) > DERIVA_MAXIMA_MS,
            ...(entrada.confidence !== undefined ? { confidence: entrada.confidence } : {}),
          },
        },
        tx,
      );

      // Retry nao republica: o consumidor ja recebeu na primeira vez, e o
      // recibo de inbox dele nao protege contra evento DUPLICADO no outbox,
      // so contra reprocessamento do mesmo `event_id`.
      if (!resultado.jaExistia) {
        await tx.outboxEvent.create({
          data: {
            tenantId: edge.tenantId,
            // ADR-005: o nome do evento mantem `Granted`/`Denied` como
            // rotulo historico; quem carrega o vocabulario e o `outcome`.
            eventType: decisao.outcome === 'ALLOW' ? 'AccessGranted' : 'AccessDenied',
            aggregateType: 'AccessEvent',
            aggregateId: resultado.evento.id,
            // Payload SEM CPF, divida, foto ou template (`M1` §15).
            payload: {
              accessEventId: resultado.evento.id,
              gymUnitId: edge.gymUnitId,
              studentId: decisao.studentId,
              outcome: decisao.outcome,
              reason: decisao.reason,
              mode: 'ONLINE',
              occurredAt: decisao.avaliadoEm.toISOString(),
              correlationId: entrada.correlationId,
            },
            occurredAt: decisao.avaliadoEm,
          },
        });
      }

      return resultado;
    });

    return {
      accessEventId: evento.id,
      correlationId: evento.correlationId,
      outcome: evento.outcome,
      reason: evento.reason,
      policyVersion: evento.policyVersion,
      validUntil: evento.validUntil?.toISOString() ?? null,
      replayed: jaExistia,
    };
  }
}
