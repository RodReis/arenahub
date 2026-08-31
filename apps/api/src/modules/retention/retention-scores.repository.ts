import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import type {
  MotivoDeSupressao,
  RazaoDeInelegibilidade,
  StatusDaAssinatura,
  StatusDoAluno,
} from './domain/elegibilidade.js';
import type { DirecaoDeRegra, OperadorDeRegra, RegraDeRetencao } from './domain/regra-de-retencao.js';
import { ausente, observado, type ValorDeFeature } from './domain/valor-de-feature.js';

export const PORTA_DE_SCORES = Symbol('PortaDeScores');

/** O catalogo congelado que uma rodada usa, inteiro. */
export interface CatalogoDeRegras {
  readonly versaoId: string;
  readonly label: string;
  readonly regras: readonly RegraDeRetencao[];
  /** Pisos das faixas, do maior para o menor. Versionados junto das regras. */
  readonly faixas: readonly (readonly [FaixaDeRisco, number])[];
  readonly completudeMinima: number;
}

/** Um snapshot pronto para pontuar, com o estado que decide elegibilidade. */
export interface SnapshotParaPontuar {
  readonly snapshotId: string;
  readonly studentId: string;
  readonly observadoEm: Date;
  readonly valores: readonly ValorDeFeature[];
  readonly statusDoAluno: StatusDoAluno;
  readonly statusDaAssinatura: StatusDaAssinatura;
  readonly supressoesVigentes: readonly MotivoDeSupressao[];
}

export interface FatorParaGravar {
  readonly posicao: number;
  readonly regraId: string;
  readonly feature: string;
  readonly valorObservado: number;
  readonly contribuicao: number;
  readonly direcao: DirecaoDeRegra;
  readonly rotulo: string;
}

export interface ScoreParaGravar {
  readonly snapshotId: string;
  readonly studentId: string;
  readonly versaoDeRegrasId: string;
  readonly observadoEm: Date;
  readonly valor: number;
  readonly faixa: FaixaDeRisco;
  readonly completude: number;
  readonly probabilidadeCalibrada: number | null;
  readonly fatores: readonly FatorParaGravar[];
}

export interface PuloParaRegistrar {
  readonly snapshotId: string;
  readonly studentId: string;
  readonly observadoEm: Date;
  readonly razao: RazaoDeInelegibilidade;
}

export interface ResultadoDaGravacaoDeScore {
  readonly scoreId: string;
  /** `false` quando a reexecucao encontrou o score que ja existia. */
  readonly criado: boolean;
}

export interface PortaDeScores {
  carregarCatalogo(contexto: TenantContext): Promise<CatalogoDeRegras>;
  snapshotsDoDia(contexto: TenantContext, observadoEm: Date): Promise<SnapshotParaPontuar[]>;
  gravarScore(
    contexto: TenantContext,
    entrada: ScoreParaGravar,
  ): Promise<ResultadoDaGravacaoDeScore>;
  registrarPulo(contexto: TenantContext, entrada: PuloParaRegistrar): Promise<void>;
}

/** Nao ha versao de regras congelada para este tenant. */
export class CatalogoDeRegrasAusenteError extends Error {
  constructor(tenantId: string) {
    super(`CATALOGO_DE_REGRAS_AUSENTE: nenhuma versao congelada para o tenant ${tenantId}`);
    this.name = 'CatalogoDeRegrasAusenteError';
  }
}

const OPERADOR_DO_BANCO: Record<string, OperadorDeRegra> = {
  GREATER_THAN: 'MAIOR_QUE',
  GREATER_THAN_OR_EQUAL: 'MAIOR_OU_IGUAL',
  LESS_THAN: 'MENOR_QUE',
  LESS_THAN_OR_EQUAL: 'MENOR_OU_IGUAL',
  PERCENT_DROP_AT_LEAST: 'QUEDA_PERCENTUAL_MINIMA',
};

const OPERADOR_PARA_BANCO: Record<OperadorDeRegra, string> = {
  MAIOR_QUE: 'GREATER_THAN',
  MAIOR_OU_IGUAL: 'GREATER_THAN_OR_EQUAL',
  MENOR_QUE: 'LESS_THAN',
  MENOR_OU_IGUAL: 'LESS_THAN_OR_EQUAL',
  QUEDA_PERCENTUAL_MINIMA: 'PERCENT_DROP_AT_LEAST',
};

const FAIXA_PARA_BANCO: Record<FaixaDeRisco, string> = {
  BAIXO: 'LOW',
  MEDIO: 'MEDIUM',
  ALTO: 'HIGH',
  CRITICO: 'CRITICAL',
};

const FAIXA_DO_BANCO: Record<string, FaixaDeRisco> = {
  LOW: 'BAIXO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
  CRITICAL: 'CRITICO',
};

const RAZAO_DE_PULO_PARA_BANCO: Record<RazaoDeInelegibilidade, string> = {
  CANCELADO: 'CANCELLED',
  SUPRIMIDO: 'SUPPRESSED',
  HISTORICO_INSUFICIENTE: 'INSUFFICIENT_HISTORY',
};

const SUPRESSAO_DO_BANCO: Record<string, MotivoDeSupressao> = {
  OPT_OUT: 'OPT_OUT',
  DELETION_PENDING: 'EXCLUSAO_PENDENTE',
  MANUAL_WITH_REASON: 'MANUAL_COM_MOTIVO',
};

const RAZAO_DE_AUSENCIA_DO_BANCO = {
  NO_HISTORY: 'SEM_HISTORICO',
  SOURCE_UNAVAILABLE: 'FONTE_INDISPONIVEL',
  NOT_APPLICABLE: 'NAO_APLICAVEL',
  SUPPRESSED: 'SUPRIMIDA',
} as const;

/** `P2002` sem `instanceof`: o erro cruza fronteira de modulo e perde o prototipo. */
function erroDeUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Leitura e gravacao dos scores explicaveis (F37).
 *
 * ---------------------------------------------------------------------------
 * A CHAVE UNICA DECIDE A REEXECUCAO, NAO UM `if`
 * ---------------------------------------------------------------------------
 *
 * A F36 aprendeu isso na revisao adversarial: `findUnique`-depois-`create`
 * perde a corrida por construcao, porque dois workers passam os dois pelo
 * `findUnique` antes de qualquer commit. Aqui a gravacao tenta escrever e trata
 * `P2002` -- o indice `(snapshot, provider, versao)` e quem garante
 * `M6-NFR-002`, e reexecutar continua sendo inofensivo sob concorrencia.
 */
@Injectable()
export class RetentionScoresRepository implements PortaDeScores {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A versao congelada mais recente do tenant.
   *
   * So versao CONGELADA pontua: catalogo em edicao mudaria o score no meio da
   * rodada, e dois alunos do mesmo dia sairiam com regras diferentes.
   */
  async carregarCatalogo(contexto: TenantContext): Promise<CatalogoDeRegras> {
    const versao = await this.prisma.retentionRuleVersion.findFirst({
      where: { tenantId: contexto.tenantId, frozenAt: { not: null } },
      // Desempate por id: duas versoes congeladas no mesmo instante deixariam
      // a ordem fisica do Postgres escolher o catalogo, e ela muda apos UPDATE.
      orderBy: [{ frozenAt: 'desc' }, { id: 'desc' }],
      include: { rules: { orderBy: { id: 'asc' } } },
    });

    if (versao === null) {
      throw new CatalogoDeRegrasAusenteError(contexto.tenantId);
    }

    return {
      versaoId: versao.id,
      label: versao.label,
      regras: versao.rules.map((regra) => ({
        id: regra.id,
        feature: regra.featureName,
        operador: OPERADOR_DO_BANCO[regra.operator] ?? 'MAIOR_QUE',
        limite: Number(regra.threshold),
        peso: regra.weight,
        direcao: regra.direction === 'INCREASE' ? 'AUMENTA' : 'REDUZ',
        rotulo: regra.label,
      })),
      faixas: [
        ['CRITICO', versao.criticalFloor],
        ['ALTO', versao.highFloor],
        ['MEDIO', versao.mediumFloor],
        ['BAIXO', 0],
      ],
      completudeMinima: Number(versao.minimumCompleteness),
    };
  }

  /**
   * Os snapshots do dia, com o estado que decide elegibilidade.
   *
   * Status de aluno e de assinatura sao lidos CORRENTES de proposito: a
   * pergunta "posso ligar para este aluno hoje?" e sobre o presente, nao sobre
   * o dia observado. E a mesma escolha que a F36 fez em `alunosElegiveis`.
   */
  async snapshotsDoDia(
    contexto: TenantContext,
    observadoEm: Date,
  ): Promise<SnapshotParaPontuar[]> {
    const snapshots = await this.prisma.studentFeatureSnapshot.findMany({
      where: { tenantId: contexto.tenantId, observedAt: observadoEm },
      orderBy: [{ studentId: 'asc' }, { revision: 'desc' }],
      include: {
        values: { orderBy: { name: 'asc' } },
        student: {
          select: {
            id: true,
            status: true,
            subscriptions: {
              where: { tenantId: contexto.tenantId },
              orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
              take: 1,
              select: { status: true },
            },
            retentionSuppressions: {
              where: {
                tenantId: contexto.tenantId,
                startsAt: { lte: observadoEm },
                OR: [{ endsAt: null }, { endsAt: { gt: observadoEm } }],
              },
              select: { reason: true },
            },
          },
        },
      },
    });

    // Uma linha por aluno: a revisao mais alta e a corrente, e pontuar as duas
    // duplicaria o aluno na fila com dois numeros diferentes.
    const porAluno = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!porAluno.has(snapshot.studentId)) {
        porAluno.set(snapshot.studentId, snapshot);
      }
    }

    return [...porAluno.values()].map((snapshot) => ({
      snapshotId: snapshot.id,
      studentId: snapshot.studentId,
      observadoEm: snapshot.observedAt,
      valores: snapshot.values.map((valor): ValorDeFeature =>
        valor.value === null
          ? ausente(
              valor.name,
              RAZAO_DE_AUSENCIA_DO_BANCO[valor.missingReason ?? 'NO_HISTORY'],
              valor.provenance === 'AS_OF' ? 'AS_OF' : 'ESTADO_CORRENTE',
            )
          : observado(
              valor.name,
              Number(valor.value),
              valor.provenance === 'AS_OF' ? 'AS_OF' : 'ESTADO_CORRENTE',
            ),
      ),
      statusDoAluno: snapshot.student.status as StatusDoAluno,
      // Sem assinatura nenhuma o aluno nao esta em risco de sair de um plano
      // que nao tem -- `EXPIRED` o tira da fila pela porta da elegibilidade.
      statusDaAssinatura: (snapshot.student.subscriptions[0]?.status ?? 'EXPIRED') as StatusDaAssinatura,
      supressoesVigentes: snapshot.student.retentionSuppressions.map(
        (supressao) => SUPRESSAO_DO_BANCO[supressao.reason] ?? 'MANUAL_COM_MOTIVO',
      ),
    }));
  }

  async gravarScore(
    contexto: TenantContext,
    entrada: ScoreParaGravar,
  ): Promise<ResultadoDaGravacaoDeScore> {
    const chave = {
      snapshotId: entrada.snapshotId,
      provider: 'RULE_BASELINE' as const,
      ruleVersionId: entrada.versaoDeRegrasId,
    };

    try {
      // Score e fatores na MESMA transacao: score sem explicacao e um numero
      // que ninguem pode contestar, e a fatia inteira existe para o contrario.
      const criado = await this.prisma.retentionScore.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          snapshotId: entrada.snapshotId,
          ruleVersionId: entrada.versaoDeRegrasId,
          provider: 'RULE_BASELINE',
          value: entrada.valor,
          band: FAIXA_PARA_BANCO[entrada.faixa] as never,
          completeness: entrada.completude,
          calibratedProbability: entrada.probabilidadeCalibrada,
          observedAt: entrada.observadoEm,
          factors: {
            create: entrada.fatores.map((fator) => ({
              tenantId: contexto.tenantId,
              ruleId: fator.regraId,
              featureName: fator.feature,
              observedValue: fator.valorObservado,
              contribution: fator.contribuicao,
              direction: (fator.direcao === 'AUMENTA' ? 'INCREASE' : 'DECREASE') as never,
              label: fator.rotulo,
              position: fator.posicao,
            })),
          },
        },
        select: { id: true },
      });

      return { scoreId: criado.id, criado: true };
    } catch (erro) {
      if (!erroDeUnicidade(erro)) {
        throw erro;
      }

      // A reexecucao encontrou o score que ja existia. Devolve o existente em
      // vez de derrubar o job: `M6-NFR-002` promete que reprocessar e seguro.
      const existente = await this.prisma.retentionScore.findUnique({
        where: { snapshotId_provider_ruleVersionId: chave },
        select: { id: true },
      });

      if (existente === null) {
        throw erro;
      }

      return { scoreId: existente.id, criado: false };
    }
  }

  async registrarPulo(contexto: TenantContext, entrada: PuloParaRegistrar): Promise<void> {
    try {
      await this.prisma.retentionScoreSkip.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          snapshotId: entrada.snapshotId,
          reason: RAZAO_DE_PULO_PARA_BANCO[entrada.razao] as never,
          observedAt: entrada.observadoEm,
        },
      });
    } catch (erro) {
      // Reexecutar o dia reencontra o mesmo pulo. Nao e falha.
      if (!erroDeUnicidade(erro)) {
        throw erro;
      }
    }
  }
}

export { FAIXA_DO_BANCO, OPERADOR_PARA_BANCO };
