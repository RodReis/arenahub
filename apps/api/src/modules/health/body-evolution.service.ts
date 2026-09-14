import { Injectable, NotFoundException } from '@nestjs/common';
import type { BodyMeasurement, Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { StudentRepository } from '../students/student.repository.js';
import { AiAnalysisRepository } from './ai-analysis.repository.js';
import { AssessmentRepository, type AvaliacaoPublicada } from './assessment.repository.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { selecionarFolhas, type AvaliacaoDaSerie } from './domain/comparativo.js';
import { leituraDoPercentual, lerFaixa, type Leitura } from './domain/leitura-de-faixa.js';
import {
  REGIAO_DO_TIPO,
  type RegiaoCorporal,
  type TipoDeMedida,
} from './domain/medida.js';
import { dataLocalIso, inicioDoPeriodo, type Periodo } from './domain/periodo.js';

/**
 * Contrato de evolucao corporal para app e totem (Task 8, F-multiarquivo).
 *
 * Este arquivo e a FRONTEIRA: o boneco colorido e a serie que o celular do
 * aluno e o totem da academia consomem saem DAQUI ja com a leitura
 * resolvida -- ver o topo de `domain/leitura-de-faixa.ts` para o motivo de a
 * cor nunca ser calculada no cliente.
 *
 * Reusa a mesma janela de periodo da F18 (`inicioDoPeriodo`) e a mesma serie
 * publicada (`AssessmentRepository.listarPublicadasDoAluno`) -- nao
 * reimplementa nenhum dos dois.
 */

/** Medida de UMA regiao, com a leitura ja resolvida. */
export interface MedidaDaRegiao {
  readonly fatMassKg: number | null;
  readonly muscleMassKg: number | null;
  readonly fatReading: Leitura;
  readonly muscleReading: Leitura;
}

/** Metrica NAO segmentar do mes (peso, IMC, etc.), com leitura por percentual do padrao. */
export interface MetricaDoMes {
  readonly type: TipoDeMedida;
  readonly value: number;
  readonly unit: string | null;
  readonly reading: Leitura;
  /**
   * Faixa ABSOLUTA do fabricante (na unidade canonica) que decidiu `reading`
   * -- `null` quando a medida nao veio de laudo importado ou o laudo so trouxe
   * percentual do padrao.
   *
   * Vai junto para o app DESENHAR a faixa ao lado do valor (F-mobile-v2). A
   * leitura continua decidida aqui: o cliente pinta a barra, nunca compara o
   * valor com a faixa por conta propria (topo de `domain/leitura-de-faixa.ts`).
   */
  readonly referenceMin: number | null;
  readonly referenceMax: number | null;
}

export interface MesDaEvolucao {
  readonly assessedAtLocal: string;
  readonly regions: Readonly<Record<RegiaoCorporal, MedidaDaRegiao>>;
  readonly metrics: readonly MetricaDoMes[];
}

export interface AnaliseDaEvolucao {
  readonly positivePoints: readonly string[];
  readonly attentionPoints: readonly string[];
  readonly disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
}

export interface EvolucaoCorporal {
  readonly months: readonly MesDaEvolucao[];
  readonly latestAnalysis: AnaliseDaEvolucao | null;
}

/** As cinco regioes, sempre presentes (INV-104) -- nunca omitir a chave. */
const REGIOES: readonly RegiaoCorporal[] = ['ARM_LEFT', 'ARM_RIGHT', 'TRUNK', 'LEG_LEFT', 'LEG_RIGHT'];

/** Faixa de referencia do fabricante para UMA medida, quando ela veio de importacao revisada. */
interface FaixaDoFabricante {
  readonly min: number | null;
  readonly max: number | null;
  readonly standardPercent: number | null;
}

@Injectable()
export class BodyEvolutionService {
  constructor(
    private readonly avaliacoes: AssessmentRepository,
    private readonly analises: AiAnalysisRepository,
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
    private readonly db: PrismaService,
  ) {}

  /**
   * Monta a evolucao corporal do aluno para o periodo pedido.
   *
   * So avaliacao PUBLICADA vira mes (mesma regra da F18); correcao
   * SUBSTITUI a original na serie (INV-102, via `selecionarFolhas`).
   */
  async evolucao(
    contexto: TenantContext,
    studentId: string,
    periodo: Periodo,
    agora: Date,
  ): Promise<EvolucaoCorporal> {
    const fuso = await this.fusoDoAluno(contexto, studentId);
    const desde = inicioDoPeriodo(periodo, agora, fuso);

    const publicadas = await this.avaliacoes.listarPublicadasDoAluno(contexto, studentId, desde);

    const serie: AvaliacaoDaSerie[] = publicadas.map((avaliacao) => ({
      id: avaliacao.id,
      assessedAt: avaliacao.assessedAt,
      supersededById: avaliacao.supersededBy?.id ?? null,
      // So usado para ordenar/filtrar folhas -- o valor de cada tipo vem do
      // proprio `avaliacao.measurements` abaixo, nao deste campo.
      valor: null,
    }));

    const folhas = selecionarFolhas(serie);
    const porId = new Map<string, AvaliacaoPublicada>(publicadas.map((a) => [a.id, a]));

    const faixasPorAvaliacao = await this.faixasDoFabricante(
      contexto,
      folhas.map((f) => f.id),
    );

    const months: MesDaEvolucao[] = folhas.map((folha) => {
      const avaliacao = porId.get(folha.id);

      // A folha veio da propria serie que construimos: sempre existe.
      if (avaliacao === undefined) {
        throw new Error('avaliacao da serie ausente do mapa -- invariante quebrada');
      }

      const faixas = faixasPorAvaliacao.get(folha.id) ?? new Map<TipoDeMedida, FaixaDoFabricante>();

      return {
        assessedAtLocal: dataLocalIso(avaliacao.assessedAt, fuso),
        regions: montarRegioes(avaliacao.measurements, faixas),
        metrics: montarMetricas(avaliacao.measurements, faixas),
      };
    });

    const publicada = await this.analises.ultimaPublicada(contexto, studentId);

    return {
      months,
      latestAnalysis:
        publicada === null
          ? null
          : {
              positivePoints: [...publicada.saida.positivePoints],
              attentionPoints: [...publicada.saida.attentionPoints],
              disclaimerCode: publicada.saida.disclaimerCode,
            },
    };
  }

  /**
   * Faixa de referencia do fabricante por avaliacao e tipo, quando a medida
   * veio de arquivo revisado (F19).
   *
   * So `CONFIRMED`/`CORRECTED` viram medida oficial (mesma regra de
   * `valoresAceitos`, no dominio de importacao) -- os demais estados nunca
   * chegaram a `body_measurements`, entao nao ha faixa a juntar para eles.
   * Medida MANUAL nunca tem faixa aqui: fica sem entrada no mapa e
   * `lerFaixa` resolve `UNKNOWN` para ela -- correto, o formulario manual
   * nao carrega faixa de fabricante nenhuma.
   */
  private async faixasDoFabricante(
    contexto: TenantContext,
    assessmentIds: readonly string[],
  ): Promise<Map<string, Map<TipoDeMedida, FaixaDoFabricante>>> {
    const resultado = new Map<string, Map<TipoDeMedida, FaixaDoFabricante>>();

    if (assessmentIds.length === 0) return resultado;

    const importacoes = await this.db.assessmentImport.findMany({
      where: {
        tenantId: contexto.tenantId,
        assessmentId: { in: [...assessmentIds] },
      },
      select: {
        assessmentId: true,
        fields: {
          where: { state: { in: ['CONFIRMED', 'CORRECTED'] } },
          select: {
            type: true,
            referenceMin: true,
            referenceMax: true,
            standardPercent: true,
          },
        },
      },
    });

    for (const importacao of importacoes) {
      if (importacao.assessmentId === null) continue;

      const porTipo = new Map<TipoDeMedida, FaixaDoFabricante>();

      for (const campo of importacao.fields) {
        porTipo.set(campo.type, faixaDoCampo(campo));
      }

      resultado.set(importacao.assessmentId, porTipo);
    }

    return resultado;
  }

  /** Fuso da unidade do aluno -- mesma regra de `HealthProgressService`. */
  private async fusoDoAluno(contexto: TenantContext, studentId: string): Promise<string> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    const unidade = await this.unidades.encontrar(contexto, aluno.gymUnitId);

    if (unidade === null) {
      throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
    }

    return unidade.timezone;
  }
}

function faixaDoCampo(campo: {
  referenceMin: Prisma.Decimal | null;
  referenceMax: Prisma.Decimal | null;
  standardPercent: Prisma.Decimal | null;
}): FaixaDoFabricante {
  return {
    min: campo.referenceMin?.toNumber() ?? null,
    max: campo.referenceMax?.toNumber() ?? null,
    standardPercent: campo.standardPercent?.toNumber() ?? null,
  };
}

/**
 * As cinco regioes, SEMPRE presentes (INV-104).
 *
 * Regiao sem medida vira objeto com `null` nos valores e `UNKNOWN` nas
 * leituras -- nunca chave omitida: o cliente que espera as cinco quebraria o
 * layout do boneco no dia em que uma faltasse.
 */
function montarRegioes(
  medidas: readonly BodyMeasurement[],
  faixas: ReadonlyMap<TipoDeMedida, FaixaDoFabricante>,
): Record<RegiaoCorporal, MedidaDaRegiao> {
  const porRegiao = new Map<RegiaoCorporal, { fat: BodyMeasurement | null; muscle: BodyMeasurement | null }>();

  for (const regiao of REGIOES) {
    porRegiao.set(regiao, { fat: null, muscle: null });
  }

  for (const medida of medidas) {
    const regiao = REGIAO_DO_TIPO[medida.type];

    if (regiao === null) continue;

    const bucket = porRegiao.get(regiao);

    if (bucket === undefined) continue;

    if (medida.type.startsWith('SEGMENTAL_FAT_MASS_')) {
      bucket.fat = medida;
    } else if (medida.type.startsWith('SEGMENTAL_MUSCLE_MASS_')) {
      bucket.muscle = medida;
    }
  }

  const resultado = {} as Record<RegiaoCorporal, MedidaDaRegiao>;

  for (const regiao of REGIOES) {
    const bucket = porRegiao.get(regiao);

    // Populado no loop acima para as cinco regioes -- nunca `undefined`.
    if (bucket === undefined) {
      throw new Error('regiao ausente do mapa -- invariante quebrada');
    }

    resultado[regiao] = montarMedidaDaRegiao(bucket.fat, bucket.muscle, faixas);
  }

  return resultado;
}

function montarMedidaDaRegiao(
  fat: BodyMeasurement | null,
  muscle: BodyMeasurement | null,
  faixas: ReadonlyMap<TipoDeMedida, FaixaDoFabricante>,
): MedidaDaRegiao {
  return {
    fatMassKg: fat?.canonicalValue.toNumber() ?? null,
    muscleMassKg: muscle?.canonicalValue.toNumber() ?? null,
    fatReading: leituraDaMedida(fat, faixas),
    muscleReading: leituraDaMedida(muscle, faixas),
  };
}

function leituraDaMedida(
  medida: BodyMeasurement | null,
  faixas: ReadonlyMap<TipoDeMedida, FaixaDoFabricante>,
): Leitura {
  if (medida === null) return 'UNKNOWN';

  const faixa = faixas.get(medida.type);

  if (faixa === undefined) return 'UNKNOWN';

  // Preferimos a faixa absoluta do fabricante (min/max na unidade
  // canonica); na ausencia dela, caimos para o percentual do padrao
  // (90%-110%, `leituraDoPercentual`) -- o mesmo par de funcoes da F7,
  // nunca reimplementado aqui.
  if (faixa.min !== null || faixa.max !== null) {
    return lerFaixa(medida.canonicalValue.toNumber(), faixa.min, faixa.max);
  }

  return leituraDoPercentual(faixa.standardPercent);
}

/**
 * Metricas NAO segmentares do mes -- peso, IMC e demais tipos medidos que
 * nao mapeiam a nenhuma regiao do boneco.
 *
 * ADR-035: achado de ECG (`HEART_RATE`) pode ser exibido como texto
 * atribuido ao aparelho, mas NUNCA classificado -- por isso ele nunca entra
 * aqui como metrica com leitura. Fica de fora da lista.
 */
function montarMetricas(
  medidas: readonly BodyMeasurement[],
  faixas: ReadonlyMap<TipoDeMedida, FaixaDoFabricante>,
): MetricaDoMes[] {
  return medidas
    .filter((medida) => REGIAO_DO_TIPO[medida.type] === null)
    .filter((medida) => medida.type !== 'HEART_RATE')
    .map((medida) => ({
      type: medida.type,
      value: medida.canonicalValue.toNumber(),
      unit: medida.canonicalUnit?.toLowerCase() ?? null,
      reading: leituraDaMedida(medida, faixas),
      referenceMin: faixas.get(medida.type)?.min ?? null,
      referenceMax: faixas.get(medida.type)?.max ?? null,
    }));
}
