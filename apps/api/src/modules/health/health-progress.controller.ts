import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentRepository } from '../students/student.repository.js';
import { GoalRepository } from './goal.repository.js';
import { HealthProgressService, type ComparativoDeTipo } from './health-progress.service.js';
import { converterParaCanonica, type TipoDeMedida, type UnidadeDeMedida } from './domain/medida.js';
import { PERIODOS, dataLocalIso, ehPeriodo, type Periodo } from './domain/periodo.js';
import type { Variacao } from './domain/comparativo.js';

/**
 * Historico, comparativos e metas (F18, Slice 3.2).
 *
 * Rotas conforme o PRD (`MVP-03` secao 11):
 *
 *     GET  /api/v1/students/:id/health-progress
 *     POST /api/v1/students/:id/health-goals
 *
 * O plano de apoio propunha `/v1/health/students/:id/history`; onde os dois
 * divergem, o PRD vence (o plano e material de apoio, `CLAUDE.md`).
 *
 * Numeros saem como `number`, nao como string: o `AssessmentController` ja
 * responde assim, e duas convencoes de decimal na mesma API custariam mais
 * do que a precisao extra renderia -- o cliente que exibe arredonda de
 * qualquer forma (INV-106).
 */

const TIPOS: readonly TipoDeMedida[] = [
  'WEIGHT',
  'HEIGHT',
  'BODY_FAT_PERCENT',
  'BODY_FAT_MASS',
  'LEAN_BODY_MASS',
  'SKELETAL_MUSCLE_MASS',
  'TOTAL_BODY_WATER',
  'INTRACELLULAR_WATER',
  'EXTRACELLULAR_WATER',
  'PROTEIN_MASS',
  'MINERAL_MASS',
  'VISCERAL_FAT_LEVEL',
  'BASAL_METABOLIC_RATE',
  'WAIST_CIRCUMFERENCE',
  'HIP_CIRCUMFERENCE',
];

const UNIDADES: readonly UnidadeDeMedida[] = [
  'kg',
  'g',
  'lb',
  'cm',
  'm',
  'in',
  'percent',
  'kcal',
  'L',
];

/**
 * Meta como o avaliador combinou com o aluno.
 *
 * `baselineValue` e `targetValue` chegam na unidade em que foram MEDIDOS e
 * sao convertidos para a canonica antes de gravar (INV-105) -- a mesma regra
 * testada que as medidas usam. Sem isso, uma meta em libras compararia com
 * uma serie em quilos.
 */
const esquemaDeMeta = z
  .object({
    type: z.enum(TIPOS as [TipoDeMedida, ...TipoDeMedida[]]),
    baselineValue: z.number().finite(),
    targetValue: z.number().finite(),
    unit: z.enum(UNIDADES as [UnidadeDeMedida, ...UnidadeDeMedida[]]).nullable(),
    /** Data (`AAAA-MM-DD`), nao instante: prazo e dia combinado. */
    deadline: z.iso.date(),
  })
  .strict();

interface VariacaoDto {
  absolute: number | null;
  percent: number | null;
  /** Avaliacao de onde a comparacao parte (`M3-NFR-006`). */
  fromAssessmentId: string | null;
  toAssessmentId: string | null;
  /** Por que nao ha numero: `SEM_BASELINE`, `BASELINE_ZERO` ou `SEM_META`. */
  absentReason: string | null;
}

interface PontoDto {
  assessmentId: string;
  assessedAt: string;
  /**
   * A DATA local da medição (`AAAA-MM-DD`), no fuso da unidade.
   *
   * Existe porque o eixo do gráfico precisa de uma STRING dentro do SVG, e a
   * regra 5 de lint do painel reserva a formatação de data ao componente
   * `TenantDateTime` (que renderiza `<time>`, impossível ali). Em vez de
   * abrir exceção na lint, o servidor -- que já conhece o fuso -- entrega o
   * dia pronto.
   *
   * `assessedAt` continua sendo o instante UTC completo: quem precisa de hora
   * ou de outro formato usa ele com `TenantDateTime`.
   */
  assessedAtLocal: string;
  value: number;
}

interface ComparativoDto {
  type: string;
  unit: string | null;
  points: PontoDto[];
  first: PontoDto | null;
  previous: PontoDto | null;
  current: PontoDto | null;
  sinceFirst: VariacaoDto;
  sincePrevious: VariacaoDto;
  toGoal: VariacaoDto;
  goal: { id: string; target: number; deadline: string } | null;
}

interface HistoricoDto {
  studentId: string;
  period: string;
  /** Fuso da unidade do aluno -- o cliente formata os instantes com ele. */
  timezone: string;
  measurements: ComparativoDto[];
}

interface MetaDto {
  id: string;
  studentId: string;
  type: string;
  baselineValue: number;
  targetValue: number;
  unit: string | null;
  deadline: string;
  createdByUserId: string;
  achievedAt: string | null;
  closedAt: string | null;
}

@Controller('api/v1')
export class HealthProgressController {
  constructor(
    private readonly progresso: HealthProgressService,
    private readonly metas: GoalRepository,
    private readonly alunos: StudentRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Historico e comparativos do aluno (`M3-FR-007`, `M3-FR-008`).
   *
   * `period` invalido responde 400 em vez de cair no padrao: o cliente que
   * mandou `60D` esperava 60 dias, e devolver 30 calado mostraria um grafico
   * que ele nao pediu.
   */
  @Get('students/:id/health-progress')
  @RequirePermissions('health.read')
  async historico(
    @Param('id') studentId: string,
    @Query('period') period?: string,
  ): Promise<HistoricoDto> {
    const periodo = this.exigirPeriodo(period);

    const historico = await this.progresso.historico(
      this.contexto.require(),
      studentId,
      periodo,
      new Date(),
    );

    return {
      studentId,
      period: historico.periodo,
      timezone: historico.fuso,
      measurements: historico.tipos.map((tipo) => paraComparativoDto(tipo, historico.fuso)),
    };
  }

  /** Metas ATIVAS do aluno. */
  @Get('students/:id/health-goals')
  @RequirePermissions('health.read')
  async listarMetas(@Param('id') studentId: string): Promise<MetaDto[]> {
    await this.exigirAluno(studentId);

    const metas = await this.metas.listarAtivas(this.contexto.require(), studentId);

    return metas.map((meta) => paraMetaDto(meta, studentId));
  }

  /**
   * Cria a meta (`M3-FR-012`).
   *
   * Segunda meta ativa do mesmo tipo responde 409 -- a garantia e o indice
   * parcial do banco, nao uma leitura previa aqui.
   */
  @Post('students/:id/health-goals')
  @RequirePermissions('health.assess')
  async criarMeta(@Param('id') studentId: string, @Body() corpo: unknown): Promise<MetaDto> {
    const dados = esquemaDeMeta.parse(corpo);
    const contexto = this.contexto.require();

    // ANTES de gravar: `studentId` vem da URL, e o tenant do contexto. Sem
    // esta checagem, a academia B criaria meta apontando para aluno da
    // academia A -- a linha nasceria com o `tenant_id` de B e o `student_id`
    // de A, orfa e invisivel para os dois lados (INV-006).
    await this.exigirAluno(studentId);

    // Converte ANTES de gravar, pela mesma regra testada das medidas: meta em
    // libras contra serie em quilos compararia grandezas diferentes.
    const baseline = converterParaCanonica({
      type: dados.type,
      value: dados.baselineValue,
      unit: dados.unit,
    });
    const alvo = converterParaCanonica({
      type: dados.type,
      value: dados.targetValue,
      unit: dados.unit,
    });

    const meta = await this.metas.criar(contexto, studentId, {
      type: dados.type,
      baselineValue: baseline.canonicalValue,
      targetValue: alvo.canonicalValue,
      unit: alvo.canonicalUnit,
      // `AAAA-MM-DD` vira meia-noite UTC. A coluna e `DATE`: o banco guarda o
      // dia, sem hora.
      deadline: new Date(`${dados.deadline}T00:00:00.000Z`),
      createdByUserId: contexto.actorId,
    });

    return paraMetaDto(meta, studentId);
  }

  /** Encerra a meta. Encerrada nao some -- deixa de disputar o tipo. */
  @Post('health-goals/:id/close')
  @RequirePermissions('health.assess')
  async encerrarMeta(@Param('id') goalId: string): Promise<MetaDto> {
    const meta = await this.metas.encerrar(this.contexto.require(), goalId, new Date());

    return paraMetaDto(meta, meta.studentId);
  }

  /**
   * O aluno existe NESTE tenant?
   *
   * 404 tambem quando ele e de outra academia -- responder 403 vazaria que
   * aquele id existe em algum lugar (INV-006, oraculo de existencia entre
   * academias).
   */
  private async exigirAluno(studentId: string): Promise<void> {
    const aluno = await this.alunos.encontrar(this.contexto.require(), studentId);

    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
  }

  private exigirPeriodo(period: string | undefined): Periodo {
    // Sem `period` na query, o padrao e 90D: cobre o intervalo tipico entre
    // avaliacoes sem estourar a tela na primeira visita.
    if (period === undefined || period === '') return '90D';

    if (!ehPeriodo(period)) {
      throw new BadRequestException({
        code: 'HEALTH_INVALID_PERIOD',
        detail: `periodo invalido; use um de ${PERIODOS.join(', ')}`,
      });
    }

    return period;
  }
}

function paraVariacaoDto(variacao: Variacao): VariacaoDto {
  return {
    absolute: variacao.absoluta,
    percent: variacao.percentual,
    fromAssessmentId: variacao.deId,
    toAssessmentId: variacao.paraId,
    absentReason: variacao.razao,
  };
}

function pontoDto(ponto: { id: string; assessedAt: Date; valor: number }, fuso: string): PontoDto {
  return {
    assessmentId: ponto.id,
    assessedAt: ponto.assessedAt.toISOString(),
    assessedAtLocal: dataLocalIso(ponto.assessedAt, fuso),
    value: ponto.valor,
  };
}

function paraComparativoDto(comparativo: ComparativoDeTipo, fuso: string): ComparativoDto {
  const ponto = (p: { id: string; assessedAt: Date; valor: number } | null): PontoDto | null =>
    p === null ? null : pontoDto(p, fuso);

  return {
    type: comparativo.type,
    unit: comparativo.unidade,
    points: comparativo.comparativo.pontos.map((p) => pontoDto(p, fuso)),
    first: ponto(comparativo.comparativo.primeira),
    previous: ponto(comparativo.comparativo.anterior),
    current: ponto(comparativo.comparativo.atual),
    sinceFirst: paraVariacaoDto(comparativo.comparativo.desdeAPrimeira),
    sincePrevious: paraVariacaoDto(comparativo.comparativo.desdeAAnterior),
    toGoal: paraVariacaoDto(comparativo.comparativo.ateAMeta),
    goal:
      comparativo.meta === null
        ? null
        : {
            id: comparativo.meta.id,
            target: comparativo.meta.alvo,
            deadline: comparativo.meta.deadline.toISOString().slice(0, 10),
          },
  };
}

function paraMetaDto(
  meta: {
    id: string;
    type: string;
    baselineValue: { toNumber(): number };
    targetValue: { toNumber(): number };
    unit: string | null;
    deadline: Date;
    createdByUserId: string;
    achievedAt: Date | null;
    closedAt: Date | null;
  },
  studentId: string,
): MetaDto {
  return {
    id: meta.id,
    studentId,
    type: meta.type,
    // `Decimal` vira `number` so na BORDA (INV-106).
    baselineValue: meta.baselineValue.toNumber(),
    targetValue: meta.targetValue.toNumber(),
    unit: meta.unit,
    deadline: meta.deadline.toISOString().slice(0, 10),
    createdByUserId: meta.createdByUserId,
    achievedAt: meta.achievedAt?.toISOString() ?? null,
    closedAt: meta.closedAt?.toISOString() ?? null,
  };
}
