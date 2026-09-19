import { Injectable } from '@nestjs/common';
import type { Class, ClassException } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { GymUnitModalityRepository } from '../tenancy/gym-unit-modality.repository.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { validarGrade, type GradeDeAula, type TipoDeExcecao } from './domain/class.js';

export class UnidadeNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('UNIT_NOT_FOUND', 404, 'Unidade nao encontrada');
  }
}

export class ModalidadeNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('MODALITY_NOT_FOUND', 404, 'Modalidade nao encontrada nesta unidade');
  }
}

export class ProfessorInvalidoError extends ErroDeDominio {
  constructor() {
    super(
      'TRAINER_INVALID',
      422,
      'Professor deve ser um aluno com profile TRAINER neste tenant',
    );
  }
}

export class AulaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('CLASS_NOT_FOUND', 404, 'Aula nao encontrada');
  }
}

export class ExcecaoJaExisteNoDiaError extends ErroDeDominio {
  constructor() {
    super(
      'CLASS_EXCEPTION_ALREADY_EXISTS',
      409,
      'Ja existe uma excecao registrada para esta aula neste dia',
    );
  }
}

export interface DadosDeCriacaoDeAula extends GradeDeAula {
  gymUnitId: string;
  modalityId: string;
  trainerId?: string | undefined;
}

export interface DadosDeEdicaoDeAula extends GradeDeAula {
  modalityId: string;
  trainerId?: string | undefined;
}

/**
 * Acesso a agenda de aulas -- F77 (SPEC-077, ADR-061).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento (INV-003,
 * regra de arquitetura no 2), mesmo padrao de `GymUnitModalityRepository`.
 *
 * NAO CONSULTADO PELO MOTOR DE ACESSO. Nenhum caminho deste arquivo alimenta
 * `AccessDecisionEngine` -- ADR-061 decisao no 2.
 */
@Injectable()
export class ClassRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly unidades: GymUnitRepository,
    private readonly modalidades: GymUnitModalityRepository,
  ) {}

  async listar(contexto: TenantContext, gymUnitId: string): Promise<Class[]> {
    return this.db.class.findMany({
      where: { tenantId: contexto.tenantId, gymUnitId },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async encontrar(contexto: TenantContext, id: string): Promise<Class | null> {
    return this.db.class.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  async criar(
    contexto: TenantContext,
    dados: DadosDeCriacaoDeAula,
    correlationId: string,
  ): Promise<Class> {
    validarGrade(dados);

    await this.validarUnidadeModalidadeProfessor(
      contexto,
      dados.gymUnitId,
      dados.modalityId,
      dados.trainerId,
    );

    return this.db.$transaction(async (tx) => {
      const aula = await tx.class.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: dados.gymUnitId,
          modalityId: dados.modalityId,
          trainerId: dados.trainerId ?? null,
          dayOfWeek: dados.dayOfWeek,
          startMinute: dados.startMinute,
          durationMinutes: dados.durationMinutes,
          capacity: dados.capacity,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: dados.gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class.created',
          target: 'class',
          targetId: aula.id,
          correlationId,
          metadata: { modalityId: dados.modalityId, dayOfWeek: dados.dayOfWeek },
        },
      });

      return aula;
    });
  }

  /**
   * `updateMany` com `tenantId` no filtro -- mesmo motivo de
   * `GymUnitModalityRepository.atualizar`: id de outro tenant nao entra no
   * conjunto, em vez de ser encontrado e so depois recusado.
   */
  async editar(
    contexto: TenantContext,
    id: string,
    dados: DadosDeEdicaoDeAula,
    correlationId: string,
  ): Promise<Class | null> {
    validarGrade(dados);

    const existente = await this.encontrar(contexto, id);
    if (!existente) return null;

    await this.validarUnidadeModalidadeProfessor(
      contexto,
      existente.gymUnitId,
      dados.modalityId,
      dados.trainerId,
    );

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.class.updateMany({
        where: { id, tenantId: contexto.tenantId },
        data: {
          modalityId: dados.modalityId,
          trainerId: dados.trainerId ?? null,
          dayOfWeek: dados.dayOfWeek,
          startMinute: dados.startMinute,
          durationMinutes: dados.durationMinutes,
          capacity: dados.capacity,
        },
      });

      if (alterados.count === 0) return null;

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: existente.gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class.updated',
          target: 'class',
          targetId: id,
          correlationId,
          metadata: { modalityId: dados.modalityId },
        },
      });

      return tx.class.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }

  /**
   * Liga/desliga a aula da grade. INATIVAR, NUNCA APAGAR -- a F78 vai
   * gravar reserva apontando para aqui.
   */
  async alterarAtivacao(
    contexto: TenantContext,
    id: string,
    isActive: boolean,
    correlationId: string,
  ): Promise<Class | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.class.updateMany({
        where: { id, tenantId: contexto.tenantId },
        data: { isActive },
      });

      if (alterados.count === 0) return null;

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class.activation_changed',
          target: 'class',
          targetId: id,
          correlationId,
          metadata: { isActive },
        },
      });

      return tx.class.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }

  async listarExcecoes(
    contexto: TenantContext,
    classId: string,
  ): Promise<ClassException[]> {
    return this.db.classException.findMany({
      where: { tenantId: contexto.tenantId, classId },
      orderBy: { occurrenceDate: 'asc' },
    });
  }

  /**
   * Registra excecao de calendario: cancela UMA ocorrencia ou troca o
   * professor de UM dia, sem desfazer a grade.
   *
   * A UNICIDADE E DO BANCO (`@@unique([classId, occurrenceDate])`), nao de
   * um `SELECT` antes -- mesmo motivo de `GymUnitModalityRepository.criar`:
   * duas requisicoes simultaneas registrando excecao no mesmo feriado
   * passariam as duas por uma checagem previa.
   */
  async registrarExcecao(
    contexto: TenantContext,
    entrada: {
      classId: string;
      occurrenceDate: Date;
      type: TipoDeExcecao;
      overrideTrainerId?: string | undefined;
    },
    correlationId: string,
  ): Promise<ClassException> {
    const aula = await this.encontrar(contexto, entrada.classId);
    if (!aula) throw new AulaNaoEncontradaError();

    if (entrada.type === 'TRAINER_OVERRIDE' && entrada.overrideTrainerId) {
      const overrideTrainerId = entrada.overrideTrainerId;

      // `comTenant`, mesmo motivo de `validarUnidadeModalidadeProfessor`.
      const professor = await this.db.comTenant((tx) =>
        tx.student.findFirst({
          where: {
            id: overrideTrainerId,
            tenantId: contexto.tenantId,
            profile: 'TRAINER',
            archivedAt: null,
          },
          select: { id: true },
        }),
      );

      if (!professor) throw new ProfessorInvalidoError();
    }

    try {
      return await this.db.$transaction(async (tx) => {
        const excecao = await tx.classException.create({
          data: {
            tenantId: contexto.tenantId,
            classId: entrada.classId,
            occurrenceDate: entrada.occurrenceDate,
            type: entrada.type,
            overrideTrainerId:
              entrada.type === 'TRAINER_OVERRIDE' ? (entrada.overrideTrainerId ?? null) : null,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId: contexto.tenantId,
            gymUnitId: aula.gymUnitId,
            actorType: 'USER',
            actorId: contexto.actorId,
            action: 'class.exception_registered',
            target: 'class_exception',
            targetId: excecao.id,
            correlationId,
            metadata: { classId: entrada.classId, type: entrada.type },
          },
        });

        return excecao;
      });
    } catch (erro) {
      if (ehViolacaoDeUnicidade(erro)) throw new ExcecaoJaExisteNoDiaError();

      throw erro;
    }
  }

  private async validarUnidadeModalidadeProfessor(
    contexto: TenantContext,
    gymUnitId: string,
    modalityId: string,
    trainerId: string | undefined,
  ): Promise<void> {
    const unidade = await this.unidades.encontrar(contexto, gymUnitId);
    if (!unidade) throw new UnidadeNaoEncontradaError();

    const [modalidade] = await this.modalidades.encontrarNaUnidade(contexto, gymUnitId, [
      modalityId,
    ]);
    if (!modalidade) throw new ModalidadeNaoEncontradaError();

    if (trainerId) {
      // `comTenant`: `students` tem politica RLS (F66) -- consulta direta,
      // fora de transacao interceptada, devolve VAZIA sob o role restrito e
      // o professor legitimo vira `TRAINER_INVALID` (mesma armadilha da
      // issue #302 e #306).
      const professor = await this.db.comTenant((tx) =>
        tx.student.findFirst({
          where: {
            id: trainerId,
            tenantId: contexto.tenantId,
            profile: 'TRAINER',
            archivedAt: null,
          },
          select: { id: true },
        }),
      );

      if (!professor) throw new ProfessorInvalidoError();
    }
  }
}

/**
 * `P2002` e o codigo de violacao de indice unico do Prisma -- mesmo motivo
 * de `GymUnitModalityController`.
 */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
