import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentRepository } from '../students/student.repository.js';
import { AssessmentRepository, type AvaliacaoComMedidas } from './assessment.repository.js';
import {
  FATORES,
  type FatorDeContexto,
  analiseBloqueada,
  avisosSuprimidos,
} from './domain/contexto-de-saude.js';
import {
  converterParaCanonica,
  type MedidaCanonica,
  type TipoDeMedida,
  type UnidadeDeMedida,
} from './domain/medida.js';

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
 * Medida como o avaliador digitou.
 *
 * `unit` e `nullable`, nao `optional`: para tipo adimensional o cliente
 * manda `null` explicitamente. Omitir seria indistinguivel de esquecer, e
 * `converterParaCanonica` recusa os dois -- mas com mensagem diferente.
 */
const esquemaDeMedida = z
  .object({
    type: z.enum(TIPOS as [TipoDeMedida, ...TipoDeMedida[]]),
    value: z.number().finite(),
    unit: z.enum(UNIDADES as [UnidadeDeMedida, ...UnidadeDeMedida[]]).nullable(),
  })
  .strict();

const esquemaDeAvaliacao = z
  .object({
    assessedAt: z.iso.datetime(),
    notes: z.string().max(2_000).optional(),
    /**
     * Pelo menos uma medida. Avaliacao vazia nao chega nem a rascunho: o
     * dominio ja recusaria na publicacao, e recusar aqui poupa a linha.
     */
    measurements: z.array(esquemaDeMedida).min(1),
  })
  .strict();

const esquemaDeRascunho = z
  .object({
    notes: z.string().max(2_000).optional(),
    measurements: z.array(esquemaDeMedida).min(1),
  })
  .strict();

const esquemaDeFator = z
  .object({
    factor: z.enum(FATORES as [FatorDeContexto, ...FatorDeContexto[]]),
  })
  .strict();

interface MedidaDto {
  type: string;
  originalValue: number;
  originalUnit: string | null;
  canonicalValue: number;
  canonicalUnit: string | null;
  source: string;
}

interface AvaliacaoDto {
  id: string;
  studentId: string;
  status: string;
  assessedAt: string;
  publishedAt: string | null;
  source: string;
  evaluatorUserId: string;
  /** Avaliacao que esta corrige. `null` quando e original. */
  supersedesAssessmentId: string | null;
  notes: string | null;
  measurements: MedidaDto[];
}

interface ContextoDto {
  factors: string[];
  /** Avisos de faixa que os fatores ativos suprimem (ADR-037). */
  suppressedWarnings: string[];
  /** Gestante/pos-parto: registra sem interpretar. */
  analysisBlocked: boolean;
}

function paraDto(avaliacao: AvaliacaoComMedidas): AvaliacaoDto {
  return {
    id: avaliacao.id,
    studentId: avaliacao.studentId,
    status: avaliacao.status,
    assessedAt: avaliacao.assessedAt.toISOString(),
    publishedAt: avaliacao.publishedAt?.toISOString() ?? null,
    source: avaliacao.source,
    evaluatorUserId: avaliacao.evaluatorUserId,
    supersedesAssessmentId: avaliacao.supersedesAssessmentId,
    notes: avaliacao.notes,
    measurements: avaliacao.measurements.map((medida) => ({
      type: medida.type,
      // `Decimal` do Prisma vira `number` so na BORDA. O calculo e a
      // comparacao usam a precisao armazenada (INV-106).
      originalValue: medida.originalValue.toNumber(),
      originalUnit: medida.originalUnit,
      canonicalValue: medida.canonicalValue.toNumber(),
      canonicalUnit: medida.canonicalUnit,
      source: medida.source,
    })),
  };
}

/** Converte todas as medidas antes de gravar qualquer uma. */
function converterTodas(
  medidas: readonly { type: TipoDeMedida; value: number; unit: UnidadeDeMedida | null }[],
): MedidaCanonica[] {
  // Converter tudo primeiro e proposital: uma medida invalida no meio da
  // lista aborta a avaliacao inteira, em vez de gravar metade.
  return medidas.map((medida) => converterParaCanonica(medida));
}

/**
 * Avaliacao fisica manual e contexto de saude (F17, Slice 3.1).
 *
 * **Consentimento nao trava nada aqui.** A Arena Positiva ja coleta peso,
 * gordura e medidas ha anos como parte do servico contratado -- trocar o
 * caderno pelo ArenaHub e mudanca de MEIO DE REGISTRO, nao inicio de
 * tratamento (mesmo raciocinio do ADR-034 decisao 10). O ato genuinamente
 * novo -- enviar numero a um terceiro fora do Brasil -- e aceite da F21.
 */
@Controller('api/v1')
export class AssessmentController {
  constructor(
    private readonly avaliacoes: AssessmentRepository,
    private readonly alunos: StudentRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get('students/:id/assessments')
  @RequirePermissions('health.read')
  async listar(@Param('id') studentId: string): Promise<AvaliacaoDto[]> {
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    const avaliacoes = await this.avaliacoes.listarDoAluno(contexto, studentId);

    return avaliacoes.map(paraDto);
  }

  /** Cria o rascunho. Publicar e passo separado e explicito. */
  @Post('students/:id/assessments')
  @RequirePermissions('health.assess')
  async criar(@Param('id') studentId: string, @Body() corpo: unknown): Promise<AvaliacaoDto> {
    const dados = esquemaDeAvaliacao.parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    const avaliacao = await this.avaliacoes.criarRascunho(contexto, studentId, {
      assessedAt: new Date(dados.assessedAt),
      evaluatorUserId: contexto.actorId,
      notes: dados.notes,
      medidas: converterTodas(dados.measurements),
    });

    return paraDto(avaliacao);
  }

  @Get('assessments/:id')
  @RequirePermissions('health.read')
  async consultar(@Param('id') assessmentId: string): Promise<AvaliacaoDto> {
    const avaliacao = await this.avaliacoes.encontrar(this.contexto.require(), assessmentId);

    if (!avaliacao) throw new NotFoundException({ code: 'HEALTH_ASSESSMENT_NOT_FOUND' });

    return paraDto(avaliacao);
  }

  /** Edita o RASCUNHO. Publicada recusa com `HEALTH_ASSESSMENT_IMMUTABLE`. */
  @Patch('assessments/:id/draft')
  @RequirePermissions('health.assess')
  async editarRascunho(
    @Param('id') assessmentId: string,
    @Body() corpo: unknown,
  ): Promise<AvaliacaoDto> {
    const dados = esquemaDeRascunho.parse(corpo);

    const avaliacao = await this.avaliacoes.substituirMedidasDoRascunho(
      this.contexto.require(),
      assessmentId,
      converterTodas(dados.measurements),
      dados.notes,
    );

    return paraDto(avaliacao);
  }

  /** Publica. A partir daqui a avaliacao e imutavel (INV-102). */
  @Post('assessments/:id/publish')
  @RequirePermissions('health.assess')
  async publicar(@Param('id') assessmentId: string): Promise<AvaliacaoDto> {
    const avaliacao = await this.avaliacoes.publicar(
      this.contexto.require(),
      assessmentId,
      new Date(),
    );

    return paraDto(avaliacao);
  }

  /**
   * Corrige uma avaliacao publicada criando OUTRA, vinculada (INV-102).
   *
   * A original continua publicada e visivel: apagar destruiria a prova de
   * que o numero errado circulou.
   */
  @Post('assessments/:id/corrections')
  @RequirePermissions('health.assess')
  async corrigir(
    @Param('id') assessmentId: string,
    @Body() corpo: unknown,
  ): Promise<AvaliacaoDto> {
    const dados = esquemaDeAvaliacao.parse(corpo);
    const contexto = this.contexto.require();

    const correcao = await this.avaliacoes.criarCorrecao(
      contexto,
      assessmentId,
      {
        // O aluno NAO entra aqui: sai da avaliacao original. Correcao que
        // trocasse de aluno moveria historico de saude entre pessoas.
        assessedAt: new Date(dados.assessedAt),
        evaluatorUserId: contexto.actorId,
        notes: dados.notes,
        medidas: converterTodas(dados.measurements),
      },
      new Date(),
    );

    return paraDto(correcao);
  }

  /** Fatores ativos e o que eles suprimem (ADR-037). */
  @Get('students/:id/health-context')
  @RequirePermissions('health.read')
  async consultarContexto(@Param('id') studentId: string): Promise<ContextoDto> {
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    const registros = await this.avaliacoes.listarContextoAtivo(contexto, studentId);
    const fatores = registros.map((registro) => registro.factor);

    return {
      factors: fatores,
      suppressedWarnings: avisosSuprimidos(fatores),
      analysisBlocked: analiseBloqueada(fatores),
    };
  }

  /** Ativa um fator. Quem registra e o AVALIADOR, nunca a recepcao. */
  @Post('students/:id/health-context')
  @RequirePermissions('health.assess')
  async ativarFator(
    @Param('id') studentId: string,
    @Body() corpo: unknown,
  ): Promise<ContextoDto> {
    const dados = esquemaDeFator.parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    await this.avaliacoes.ativarFator(
      contexto,
      studentId,
      dados.factor,
      contexto.actorId,
      new Date(),
    );

    return this.consultarContexto(studentId);
  }

  /** Desativa o fator sem apagar a linha -- o snapshot da F21 depende dela. */
  @Delete('students/:id/health-context/:factor')
  @RequirePermissions('health.assess')
  async desativarFator(
    @Param('id') studentId: string,
    @Param('factor') factor: string,
  ): Promise<ContextoDto> {
    const { factor: valido } = esquemaDeFator.parse({ factor });
    const contexto = this.contexto.require();

    await this.exigirAluno(studentId);

    await this.avaliacoes.desativarFator(contexto, studentId, valido, new Date());

    return this.consultarContexto(studentId);
  }

  private async exigirAluno(studentId: string): Promise<void> {
    const aluno = await this.alunos.encontrar(this.contexto.require(), studentId);

    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
  }
}
