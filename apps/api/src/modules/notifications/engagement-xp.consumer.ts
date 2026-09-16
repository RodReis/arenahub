import { Inject, Injectable, Logger } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PORTA_DE_XP, type PortaDeXp } from '../engagement/engagement-xp.repository.js';
import { concederPorEvento } from '../engagement/domain/movimento-de-xp.js';
import { resolverRegraVigente, type GatilhoDeXp } from '../engagement/domain/regra-de-xp.js';
import type { OrigemDeMovimento } from '../engagement/domain/movimento-de-xp.js';
import type { EventoDeOutbox } from './domain/mapa-de-avisos.js';
import { PORTA_DE_AVISOS, type PortaDeAvisos } from './notifications-inbox.repository.js';
import type { ConsumidorDeEvento } from './outbox-dispatcher.service.js';

/** Sem usuario de painel agindo -- quem "age" e o proprio despachante.
 * Mesmo padrao de `EngagementRankingSchedulerService.SEM_USUARIO`. */
const SEM_USUARIO = null as unknown as string;

interface MapaDeGatilho {
  gatilho: GatilhoDeXp;
  sourceKind: OrigemDeMovimento;
  /** Como achar quem e o aluno -- `null` quando o agregado JA E o aluno
   * (`Student`, caso de `HealthGoalReached`); senao o `aggregateType` que
   * `PortaDeAvisos.resolverStudentId` sabe resolver (`BodyAssessment`). */
  aggregateTypeDoAluno: string | null;
  sourceId(evento: EventoDeOutbox): string;
}

const MAPA: Record<string, MapaDeGatilho> = {
  HealthGoalReached: {
    gatilho: 'META_ATINGIDA',
    sourceKind: 'HEALTH_GOAL',
    aggregateTypeDoAluno: null,
    sourceId: (evento) =>
      typeof evento.payload['goalId'] === 'string' ? evento.payload['goalId'] : evento.aggregateId,
  },
  AssessmentPublished: {
    gatilho: 'AVALIACAO_PUBLICADA',
    sourceKind: 'ASSESSMENT',
    aggregateTypeDoAluno: 'BodyAssessment',
    sourceId: (evento) => evento.aggregateId,
  },
};

/**
 * Credita XP a partir de eventos de outbox -- F73, MVP-05 §12.
 *
 * Fecha o buraco achado na auditoria de 15/09/2026 (issue #343):
 * `AssessmentPublished`/`HealthGoalReached` eram DECLARADOS consumidos
 * pelo MVP-05 (+20/+100) e nunca produzidos de fato.
 *
 * A idempotencia de verdade e a chave unica de `XpLedgerEntry`
 * (`sourceKind` + `sourceId` + `ruleVersionId` + `type`) -- reprocessar o
 * mesmo evento colide como P2002 e o service trata como sucesso
 * idempotente, igual `concederPorSessao` ja faz.
 */
@Injectable()
export class EngagementXpConsumer implements ConsumidorDeEvento {
  readonly nome = 'engagement-xp';

  private readonly log = new Logger(EngagementXpConsumer.name);

  constructor(
    @Inject(PORTA_DE_XP) private readonly porta: PortaDeXp,
    @Inject(PORTA_DE_AVISOS) private readonly portaDeAvisos: PortaDeAvisos,
  ) {}

  trata(eventType: string): boolean {
    return eventType in MAPA;
  }

  async processar(
    evento: EventoDeOutbox & { id: string; tenantId: string },
    agora: Date,
  ): Promise<void> {
    const mapa = MAPA[evento.eventType];
    if (mapa === undefined) return;

    const studentId =
      mapa.aggregateTypeDoAluno === null
        ? evento.aggregateId
        : await this.portaDeAvisos.resolverStudentId(mapa.aggregateTypeDoAluno, evento.aggregateId);

    if (studentId === null) {
      this.log.warn(
        `evento ${evento.eventType} (${evento.id}) sem studentId resolvivel -- XP nao creditado`,
      );

      return;
    }

    const contexto: TenantContext = {
      tenantId: evento.tenantId,
      actorId: SEM_USUARIO,
      sessionId: 'engagement-xp-consumer',
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL',
    };

    const unidade = await this.porta.unidadeDoAluno(contexto, studentId);
    if (unidade === null) {
      this.log.warn(`aluno ${studentId} nao encontrado no tenant ${evento.tenantId} -- XP nao creditado`);

      return;
    }

    const regras = await this.porta.regrasDoTenant(contexto, mapa.gatilho);
    const regra = resolverRegraVigente(regras, mapa.gatilho, agora);
    if (regra === null) return;

    const movimento = concederPorEvento({
      regra,
      sourceKind: mapa.sourceKind,
      sourceId: mapa.sourceId(evento),
      occurredAt: agora,
      fusoDaUnidade: unidade.timezone,
    });

    try {
      await this.porta.gravarConcessao(contexto, { studentId, movimento, evento: { eventType: evento.eventType, aggregateType: evento.aggregateType } });
    } catch (erro: unknown) {
      const codigo = (erro as { code?: string }).code;
      // P2002 e SUCESSO: outro ciclo do despachante ja gravou este fato.
      if (codigo !== 'P2002') throw erro;
    }
  }
}
