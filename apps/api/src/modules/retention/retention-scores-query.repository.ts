import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type {
  PortaDeConsultaDeScores,
  ScoreGravado,
} from './retention-scores-query.service.js';

const FAIXA_DO_BANCO: Record<string, FaixaDeRisco> = {
  LOW: 'BAIXO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
  CRITICAL: 'CRITICO',
};

/**
 * O `include` de fatores, compartilhado pelas duas consultas.
 *
 * `orderBy: position` porque o Postgres nao promete ordem: a F36 ja perdeu um
 * dia com `include` sem `orderBy` embaralhando linha apos `UPDATE`. Aqui isso
 * trocaria a ordem dos fatores que a recepcao le, e o primeiro fator e o que
 * ela usa para abrir a conversa.
 */
const COM_FATORES = {
  factors: { orderBy: { position: 'asc' } },
} as const;

@Injectable()
export class RetentionScoresQueryRepository implements PortaDeConsultaDeScores {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A fila do dia mais recente que tem score, ordenada por risco.
   *
   * O dia sai de uma consulta propria em vez de `new Date()`: o pipeline roda de
   * madrugada e pode atrasar, e assumir "hoje" devolveria fila vazia justamente
   * na manha em que o job travou -- que e quando a recepcao mais precisa ver o
   * que tem, com a marca de idade que `M6-BR-009` exige.
   */
  async filaDeRisco(contexto: TenantContext, limite: number): Promise<ScoreGravado[]> {
    const ultimo = await this.prisma.retentionScore.findFirst({
      where: { tenantId: contexto.tenantId },
      orderBy: { observedAt: 'desc' },
      select: { observedAt: true },
    });

    if (ultimo === null) {
      return [];
    }

    const scores = await this.prisma.retentionScore.findMany({
      where: { tenantId: contexto.tenantId, observedAt: ultimo.observedAt },
      // Desempate por id: dois alunos com o mesmo score deixariam a ordem
      // fisica decidir quem a recepcao liga primeiro, e ela muda apos UPDATE.
      orderBy: [{ value: 'desc' }, { id: 'asc' }],
      take: limite,
      include: { ...COM_FATORES, ruleVersion: { select: { label: true } } },
    });

    return scores.map((score) => this.paraDominio(score));
  }

  async historicoDoAluno(
    contexto: TenantContext,
    studentId: string,
    limite: number,
  ): Promise<ScoreGravado[]> {
    const scores = await this.prisma.retentionScore.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: [{ calculatedAt: 'desc' }, { id: 'asc' }],
      take: limite,
      include: { ...COM_FATORES, ruleVersion: { select: { label: true } } },
    });

    return scores.map((score) => this.paraDominio(score));
  }

  private paraDominio(score: {
    id: string;
    studentId: string;
    value: number;
    band: string;
    completeness: unknown;
    calibratedProbability: unknown;
    observedAt: Date;
    calculatedAt: Date;
    ruleVersion: { label: string };
    factors: {
      position: number;
      featureName: string;
      observedValue: unknown;
      contribution: number;
      direction: string;
      label: string;
    }[];
  }): ScoreGravado {
    return {
      scoreId: score.id,
      studentId: score.studentId,
      valor: score.value,
      faixa: FAIXA_DO_BANCO[score.band] ?? 'BAIXO',
      completude: Number(score.completeness),
      // `Decimal` vira `number` aqui, mas `null` continua `null`: `Number(null)`
      // daria `0`, e `0` seria lido como "0% de chance", que e o oposto de
      // "nao ha probabilidade calibrada" (PRD §16).
      probabilidadeCalibrada:
        score.calibratedProbability === null ? null : Number(score.calibratedProbability),
      versaoDeRegras: score.ruleVersion.label,
      observadoEm: score.observedAt,
      calculadoEm: score.calculatedAt,
      fatores: score.factors.map((fator) => ({
        posicao: fator.position,
        feature: fator.featureName,
        valorObservado: Number(fator.observedValue),
        contribuicao: fator.contribution,
        direcao: fator.direction === 'INCREASE' ? 'AUMENTA' : 'REDUZ',
        rotulo: fator.label,
      })),
    };
  }
}
