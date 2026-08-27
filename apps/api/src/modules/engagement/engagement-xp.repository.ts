import { Injectable } from '@nestjs/common';
import { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { GatilhoDeXp, VersaoDeRegra } from './domain/regra-de-xp.js';
import type { MovimentoDeXp } from './domain/movimento-de-xp.js';
import type { DefinicaoDeConquista } from './domain/conquista.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_XP = Symbol('PortaDeXp');

/** Sessao ainda sem movimento de XP -- o que `sessoesSemMovimento` devolve. */
export interface SessaoPontuavel {
  id: string;
  occurredAt: Date;
  fusoDaUnidade: string;
}

/** O que o service precisa gravar por concessao -- ledger + outbox, na mesma transacao. */
export interface EntradaDeGravacao {
  studentId: string;
  movimento: MovimentoDeXp;
  evento: { eventType: string; aggregateType: string };
}

/** O que o service precisa gravar por conquista desbloqueada. */
export interface ConquistaParaGravar {
  studentId: string;
  definitionVersionId: string;
  unlockedAt: Date;
  evidenceEntryId: string;
}

/**
 * Movimento do ledger, na forma minima que `somarSaldo`/`avaliarConquistas`
 * consomem.
 *
 * `sourceId` e `reversesEntryId` existem para a contagem LIQUIDA de sessao:
 * um `REVERSAL` nao apaga a `GRANT` original (ledger append-only), entao
 * quem conta evidencia de conquista precisa casar o `REVERSAL` com o `id` da
 * `GRANT` que ele anula (via `reversesEntryId`) para descontar aquele
 * `sourceId` da contagem.
 */
export interface MovimentoDoLedger {
  id: string;
  points: number;
  localMonth: string;
  type: 'GRANT' | 'ADJUSTMENT' | 'REVERSAL';
  sourceKind: 'ATTENDANCE_SESSION' | 'MANUAL_ADJUSTMENT';
  sourceId: string;
  reversesEntryId: string | null;
}

/**
 * Um movimento do ledger, na forma que o EXTRATO do totem mostra
 * (`M5-FR-004`, §13 do PRD: sempre mostrar POR QUE o aluno recebeu).
 *
 * `regra` e o `code` de `XpRuleVersion` para GRANT; para ADJUSTMENT/REVERSAL
 * (que nao tem regra, so motivo) cai no `reason` gravado no proprio
 * movimento -- `XpLedgerEntry.reason` e obrigatorio para os dois.
 */
export interface MovimentoDoExtratoDeXp {
  pontos: number;
  regra: string;
  quando: Date;
}

/**
 * Uma conquista do aluno, incluindo a REVERTIDA -- o extrato nao esconde
 * estorno.
 *
 * `motivo` e obrigatorio na LEITURA (nao opcional) porque uma conquista que
 * perde o desbloqueio sem dizer por que levanta a pergunta sem responder --
 * pior do que nao mostrar nada (§13 do PRD, `M5-FR-007`). E `null` quando a
 * conquista nunca foi revertida; `StudentAchievement.reversedReason` so
 * existe preenchido no caminho de estorno.
 */
export interface ConquistaDoExtratoDeXp {
  titulo: string;
  desbloqueadaEm: Date;
  revertida: boolean;
  motivo: string | null;
}

/** Politica de agrupamento de sessao vigente -- ver `StudentAttendanceSession.policyVersion`. */
const POLITICA_DE_SESSAO = 'dia-civil-local@1';

/**
 * Le e escreve o ledger de XP e as conquistas do aluno.
 *
 * `TenantContext` e o PRIMEIRO argumento de todo metodo (INV-003, regra de
 * arquitetura no 2) -- sem excecao, mesmo nos metodos so-leitura.
 */
export interface PortaDeXp {
  regrasDoTenant(contexto: TenantContext, gatilho: GatilhoDeXp): Promise<VersaoDeRegra[]>;
  sessoesSemMovimento(contexto: TenantContext, studentId: string): Promise<SessaoPontuavel[]>;
  gravarConcessao(contexto: TenantContext, entrada: EntradaDeGravacao): Promise<void>;
  /**
   * Reconstroi `StudentXpBalance` a partir do ledger inteiro do aluno --
   * SEM tocar no ledger. Task 6 e a dona: separar em Task 7 obrigaria mexer
   * de novo neste arquivo por causa de uma projecao que ja fecha aqui.
   */
  recalcularSaldo(contexto: TenantContext, studentId: string): Promise<void>;
  definicoesDeConquista(contexto: TenantContext): Promise<DefinicaoDeConquista[]>;
  conquistasDoAluno(contexto: TenantContext, studentId: string): Promise<ReadonlySet<string>>;
  gravarConquistas(contexto: TenantContext, conquistas: readonly ConquistaParaGravar[]): Promise<void>;
  saldoDoAluno(contexto: TenantContext, studentId: string, localMonth: string): Promise<number>;
  movimentosDoAluno(contexto: TenantContext, studentId: string): Promise<MovimentoDoLedger[]>;
  /** Movimentos na forma exibivel do extrato -- com a REGRA/motivo por extenso. */
  movimentosDoExtrato(contexto: TenantContext, studentId: string): Promise<MovimentoDoExtratoDeXp[]>;
  /** Conquistas do aluno na forma exibivel, incluindo as REVERTIDAS. */
  conquistasDoExtrato(contexto: TenantContext, studentId: string): Promise<ConquistaDoExtratoDeXp[]>;
}

@Injectable()
export class EngagementXpRepository implements PortaDeXp {
  constructor(private readonly db: PrismaService) {}

  async regrasDoTenant(contexto: TenantContext, gatilho: GatilhoDeXp): Promise<VersaoDeRegra[]> {
    return this.db.xpRuleVersion.findMany({
      where: { tenantId: contexto.tenantId, trigger: gatilho, status: 'APPROVED' },
    });
  }

  /**
   * As sessoes que ainda nao geraram movimento -- DUAS consultas pequenas e
   * indexadas, nao um `findMany` que carrega a vida inteira do aluno.
   *
   * Nao ha `include`/`none` de relacao aqui: `XpLedgerEntry.sourceId` aponta
   * para a sessao SEM foreign key (o ledger aceita origens de dominios
   * diferentes), entao o Prisma nao tem um `NOT EXISTS` relacional para
   * gerar. A alternativa seria uma subquery SQL crua; em vez disso, as duas
   * consultas abaixo -- sessoes do aluno e `sourceId`s ja pontuados do aluno
   * -- sao cada uma filtrada por `tenantId + studentId` (indexado) e batem
   * na casa de dezenas/poucas centenas de linhas por aluno, entao a uniao em
   * memoria via `Set` e barata: o que se queria evitar era carregar TODO o
   * ledger do tenant, nao duas consultas escopadas a um aluno so.
   */
  async sessoesSemMovimento(
    contexto: TenantContext,
    studentId: string,
  ): Promise<SessaoPontuavel[]> {
    const sessoes = await this.db.studentAttendanceSession.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        policyVersion: POLITICA_DE_SESSAO,
      },
      select: {
        id: true,
        sessionDate: true,
        firstPassageAt: true,
        gymUnit: { select: { id: true, timezone: true } },
      },
      orderBy: { sessionDate: 'asc' },
    });

    const jaPontuadas = new Set(
      (
        await this.db.xpLedgerEntry.findMany({
          where: {
            tenantId: contexto.tenantId,
            studentId,
            sourceKind: 'ATTENDANCE_SESSION',
            type: 'GRANT',
          },
          select: { sourceId: true },
        })
      ).map((movimento) => movimento.sourceId),
    );

    return sessoes
      .filter((sessao) => !jaPontuadas.has(sessao.id))
      .map((sessao) => ({
        id: sessao.id,
        /* `firstPassageAt` e o instante REAL do treino; `sessionDate` e o dia
         * civil sem hora, e usa-lo aqui colocaria todo treino a meia-noite
         * UTC -- o que joga treino da noite para o mes seguinte na virada. */
        occurredAt: sessao.firstPassageAt,
        fusoDaUnidade: sessao.gymUnit.timezone,
      }));
  }

  async gravarConcessao(contexto: TenantContext, entrada: EntradaDeGravacao): Promise<void> {
    const movimento = entrada.movimento;

    await this.db.$transaction(async (tx) => {
      const criado = await tx.xpLedgerEntry.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          type: movimento.type,
          points: movimento.points,
          ruleVersionId: movimento.ruleVersionId,
          sourceKind: movimento.sourceKind,
          sourceId: movimento.sourceId,
          reversesEntryId: movimento.reversesEntryId,
          occurredAt: movimento.occurredAt,
          localMonth: movimento.localMonth,
          reason: movimento.reason,
        },
      });

      // Evento na MESMA transacao da escrita do ledger -- regra de
      // arquitetura no 5. Nao ha despachante nesta fatia, so a gravacao.
      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: entrada.evento.eventType,
          aggregateType: entrada.evento.aggregateType,
          aggregateId: criado.id,
          payload: { studentId: entrada.studentId, points: movimento.points },
        },
      });
    });
  }

  /**
   * Recalcula `StudentXpBalance` inteiro a partir do ledger -- SEM tocar
   * no ledger. `M5-NFR-002`: apagar a projecao e recalcular tem de produzir
   * os mesmos numeros.
   */
  async recalcularSaldo(contexto: TenantContext, studentId: string): Promise<void> {
    const movimentos = await this.db.xpLedgerEntry.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      select: { points: true, localMonth: true, occurredAt: true },
    });

    const porMes = new Map<string, { points: number; entryCount: number; lastEntryAt: Date }>();
    for (const movimento of movimentos) {
      const atual = porMes.get(movimento.localMonth) ?? {
        points: 0,
        entryCount: 0,
        lastEntryAt: movimento.occurredAt,
      };

      porMes.set(movimento.localMonth, {
        points: atual.points + movimento.points,
        entryCount: atual.entryCount + 1,
        lastEntryAt: movimento.occurredAt > atual.lastEntryAt ? movimento.occurredAt : atual.lastEntryAt,
      });
    }

    for (const [localMonth, agregado] of porMes) {
      await this.db.studentXpBalance.upsert({
        where: { tenantId_studentId_localMonth: { tenantId: contexto.tenantId, studentId, localMonth } },
        create: {
          tenantId: contexto.tenantId,
          studentId,
          localMonth,
          points: agregado.points,
          entryCount: agregado.entryCount,
          lastEntryAt: agregado.lastEntryAt,
        },
        update: {
          points: agregado.points,
          entryCount: agregado.entryCount,
          lastEntryAt: agregado.lastEntryAt,
        },
      });
    }
  }

  async definicoesDeConquista(contexto: TenantContext): Promise<DefinicaoDeConquista[]> {
    return this.db.achievementDefinitionVersion.findMany({
      where: { tenantId: contexto.tenantId },
    });
  }

  async conquistasDoAluno(contexto: TenantContext, studentId: string): Promise<ReadonlySet<string>> {
    const conquistas = await this.db.studentAchievement.findMany({
      where: { tenantId: contexto.tenantId, studentId, status: 'UNLOCKED' },
      select: { definitionVersionId: true },
    });

    return new Set(conquistas.map((c) => c.definitionVersionId));
  }

  async gravarConquistas(
    contexto: TenantContext,
    conquistas: readonly ConquistaParaGravar[],
  ): Promise<void> {
    for (const conquista of conquistas) {
      try {
        await this.db.studentAchievement.create({
          data: {
            tenantId: contexto.tenantId,
            studentId: conquista.studentId,
            definitionVersionId: conquista.definitionVersionId,
            unlockedAt: conquista.unlockedAt,
            evidenceEntryId: conquista.evidenceEntryId,
          },
        });
      } catch (erro) {
        // Mesma colisao idempotente do ledger: `jaDesbloqueadas` e atalho de
        // leitura, nao garantia -- quem garante e a chave unica
        // (tenantId, studentId, definitionVersionId).
        if (!(erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')) {
          throw erro;
        }
      }
    }
  }

  async saldoDoAluno(contexto: TenantContext, studentId: string, localMonth: string): Promise<number> {
    const saldo = await this.db.studentXpBalance.findUnique({
      where: { tenantId_studentId_localMonth: { tenantId: contexto.tenantId, studentId, localMonth } },
      select: { points: true },
    });

    return saldo?.points ?? 0;
  }

  async movimentosDoAluno(contexto: TenantContext, studentId: string): Promise<MovimentoDoLedger[]> {
    return this.db.xpLedgerEntry.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        points: true,
        localMonth: true,
        type: true,
        sourceKind: true,
        sourceId: true,
        reversesEntryId: true,
      },
    });
  }

  /**
   * `regra` e o CODE da versao de regra para GRANT; ADJUSTMENT/REVERSAL nao
   * tem regra, so `reason` -- os dois sao obrigatorios no schema para os
   * tipos que os usam (`XpLedgerEntry.reason`, `packages/database`).
   */
  async movimentosDoExtrato(
    contexto: TenantContext,
    studentId: string,
  ): Promise<MovimentoDoExtratoDeXp[]> {
    const movimentos = await this.db.xpLedgerEntry.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: { occurredAt: 'asc' },
      select: {
        points: true,
        occurredAt: true,
        reason: true,
        ruleVersion: { select: { code: true } },
      },
    });

    return movimentos.map((movimento) => ({
      pontos: movimento.points,
      regra: movimento.reason ?? movimento.ruleVersion.code,
      quando: movimento.occurredAt,
    }));
  }

  /** `M5-FR-007`: revertida NAO some -- continua visivel, com o motivo anexado. */
  async conquistasDoExtrato(
    contexto: TenantContext,
    studentId: string,
  ): Promise<ConquistaDoExtratoDeXp[]> {
    const conquistas = await this.db.studentAchievement.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: { unlockedAt: 'asc' },
      select: {
        status: true,
        unlockedAt: true,
        reversedReason: true,
        definition: { select: { title: true } },
      },
    });

    return conquistas.map((conquista) => ({
      titulo: conquista.definition.title,
      desbloqueadaEm: conquista.unlockedAt,
      revertida: conquista.status === 'REVERSED',
      motivo: conquista.reversedReason,
    }));
  }
}
