import { Injectable } from '@nestjs/common';
import { Prisma, type HealthGoal } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { TipoDeMedida, UnidadeDeMedida } from './domain/medida.js';

/**
 * Meta de composicao corporal (`M3-FR-012`, F18).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 *
 * A meta NAO edita avaliacao nenhuma (Slice 3.4: "progresso calculado, sem
 * editar avaliacoes"): ela e um alvo AO LADO da serie, e o comparativo mede
 * a distancia ate ele.
 */

export class MetaJaAtivaError extends ErroDeDominio {
  constructor() {
    super(
      'HEALTH_GOAL_ALREADY_ACTIVE',
      409,
      'ja existe meta ativa deste tipo para o aluno; encerre a atual antes de criar outra',
    );
  }
}

export class MetaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('HEALTH_GOAL_NOT_FOUND', 404, 'meta nao encontrada');
  }
}

export interface DadosDaMeta {
  type: TipoDeMedida;
  baselineValue: number;
  targetValue: number;
  unit: UnidadeDeMedida | null;
  deadline: Date;
  createdByUserId: string;
}

/** Unidade do dominio (minuscula) para o enum do Prisma (maiuscula). */
function unidadeParaBanco(
  unidade: UnidadeDeMedida | null,
): 'KG' | 'G' | 'LB' | 'CM' | 'M' | 'IN' | 'PERCENT' | 'KCAL' | 'L' | null {
  if (unidade === null) return null;

  return unidade.toUpperCase() as 'KG' | 'G' | 'LB' | 'CM' | 'M' | 'IN' | 'PERCENT' | 'KCAL' | 'L';
}

@Injectable()
export class GoalRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Cria a meta. Uma ativa por tipo e por aluno.
   *
   * A garantia e o INDICE PARCIAL do banco
   * (`health_goals_uma_meta_ativa_por_tipo`, `WHERE closed_at IS NULL`), nao
   * um `findFirst` + `if`: guarda que le antes de escrever perde a corrida
   * por construcao, porque a janela entre a leitura e a escrita e exatamente
   * o que ela deveria fechar (mesma classe dos bugs da F14 e da F17).
   *
   * Aqui traduzimos `P2002` para o 409 de dominio -- o indice da a garantia,
   * este `catch` da a mensagem.
   */
  async criar(
    contexto: TenantContext,
    studentId: string,
    dados: DadosDaMeta,
  ): Promise<HealthGoal> {
    try {
      return await this.db.healthGoal.create({
        data: {
          tenantId: contexto.tenantId,
          studentId,
          type: dados.type,
          baselineValue: new Prisma.Decimal(dados.baselineValue),
          targetValue: new Prisma.Decimal(dados.targetValue),
          unit: unidadeParaBanco(dados.unit),
          deadline: dados.deadline,
          createdByUserId: dados.createdByUserId,
        },
      });
    } catch (erro) {
      if (violacaoDeUnicidade(erro)) {
        throw new MetaJaAtivaError();
      }

      throw erro;
    }
  }

  /** Metas ATIVAS do aluno -- as que o comparativo le. */
  async listarAtivas(contexto: TenantContext, studentId: string): Promise<HealthGoal[]> {
    return this.db.healthGoal.findMany({
      where: { tenantId: contexto.tenantId, studentId, closedAt: null },
      orderBy: [{ type: 'asc' }],
    });
  }

  /**
   * Encerra a meta.
   *
   * `updateMany` com `closedAt: null` no `WHERE`: encerrar duas vezes acha
   * zero linhas em vez de mover o instante de encerramento de uma meta que
   * ja estava fechada.
   */
  async encerrar(contexto: TenantContext, goalId: string, agora: Date): Promise<HealthGoal> {
    const afetadas = await this.db.healthGoal.updateMany({
      where: { id: goalId, tenantId: contexto.tenantId, closedAt: null },
      data: { closedAt: agora },
    });

    if (afetadas.count === 0) {
      throw new MetaNaoEncontradaError();
    }

    const meta = await this.db.healthGoal.findFirst({
      where: { id: goalId, tenantId: contexto.tenantId },
    });

    if (meta === null) throw new MetaNaoEncontradaError();

    return meta;
  }
}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Aqui ela significa uma coisa so: o indice parcial recusou uma segunda meta
 * ativa do mesmo tipo.
 */
function violacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
