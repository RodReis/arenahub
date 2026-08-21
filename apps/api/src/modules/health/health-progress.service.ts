import { Injectable, NotFoundException } from '@nestjs/common';
import type { BodyMeasurement, HealthGoal } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { StudentRepository } from '../students/student.repository.js';
import { AssessmentRepository, type AvaliacaoPublicada } from './assessment.repository.js';
import { GoalRepository } from './goal.repository.js';
import {
  compararSerie,
  type AvaliacaoDaSerie,
  type Comparativo,
  type MetaDaSerie,
} from './domain/comparativo.js';
import { inicioDoPeriodo, type Periodo } from './domain/periodo.js';
import type { TipoDeMedida } from './domain/medida.js';

/**
 * Historico e comparativos do aluno (F18, Slice 3.2).
 *
 * Este arquivo e a FRONTEIRA: daqui para dentro do dominio nao existe
 * Prisma, relogio nem fuso. Todo o I/O acontece aqui, e o que segue para
 * `compararSerie` e estrutura de dados inerte -- mesmo desenho de
 * `AccessProjectionRepository`.
 *
 * O fuso vem da UNIDADE do aluno, via `GymUnitRepository` (regra de
 * arquitetura no 9: modulo nao le tabela privada de outro). Sem fallback
 * para UTC: o ADR-019 exige fuso da unidade, e assumir um produziria corte
 * de periodo errado e silencioso.
 */

/** Comparativo de UM tipo de medida, com a meta ativa daquele tipo. */
export interface ComparativoDeTipo {
  readonly type: TipoDeMedida;
  readonly unidade: string | null;
  readonly comparativo: Comparativo;
  readonly meta: { id: string; alvo: number; deadline: Date } | null;
}

export interface HistoricoDoAluno {
  readonly periodo: Periodo;
  readonly fuso: string;
  readonly tipos: readonly ComparativoDeTipo[];
}

@Injectable()
export class HealthProgressService {
  constructor(
    private readonly avaliacoes: AssessmentRepository,
    private readonly metas: GoalRepository,
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
  ) {}

  /**
   * Monta o historico do aluno para o periodo pedido.
   *
   * Um comparativo POR TIPO medido: o aluno acompanha peso e gordura em
   * graficos separados, e juntar tipos de grandezas diferentes numa serie so
   * produziria uma linha sem significado.
   */
  async historico(
    contexto: TenantContext,
    studentId: string,
    periodo: Periodo,
    agora: Date,
  ): Promise<HistoricoDoAluno> {
    const fuso = await this.fusoDoAluno(contexto, studentId);
    const desde = inicioDoPeriodo(periodo, agora, fuso);

    const [publicadas, metasAtivas] = await Promise.all([
      this.avaliacoes.listarPublicadasDoAluno(contexto, studentId, desde),
      this.metas.listarAtivas(contexto, studentId),
    ]);

    const metaPorTipo = new Map<string, HealthGoal>(metasAtivas.map((m) => [m.type, m]));

    // Um tipo entra no resultado se ALGUMA avaliacao do periodo o mediu, ou
    // se ha meta ativa dele. Meta sem medicao nenhuma continua visivel: o
    // aluno precisa ver o alvo que combinou mesmo antes da primeira medicao.
    const tipos = new Set<string>([
      ...publicadas.flatMap((a) => a.measurements.map((m) => m.type)),
      ...metaPorTipo.keys(),
    ]);

    return {
      periodo,
      fuso,
      tipos: [...tipos]
        .sort()
        .map((tipo) => this.compararTipo(tipo as TipoDeMedida, publicadas, metaPorTipo.get(tipo))),
    };
  }

  private compararTipo(
    tipo: TipoDeMedida,
    publicadas: readonly AvaliacaoPublicada[],
    meta: HealthGoal | undefined,
  ): ComparativoDeTipo {
    const serie: AvaliacaoDaSerie[] = publicadas.map((avaliacao) => ({
      id: avaliacao.id,
      assessedAt: avaliacao.assessedAt,
      // A correcao SUBSTITUI a original na serie (INV-102). Quem filtra e o
      // dominio (`selecionarFolhas`); aqui so passamos o vinculo adiante.
      supersededById: avaliacao.supersededBy?.id ?? null,
      valor: valorCanonico(avaliacao.measurements, tipo),
    }));

    const alvo: MetaDaSerie | null =
      meta !== undefined
        ? { alvo: meta.targetValue.toNumber(), unidade: meta.unit?.toLowerCase() ?? null }
        : null;

    return {
      type: tipo,
      unidade: unidadeDoTipo(publicadas, tipo) ?? alvo?.unidade ?? null,
      comparativo: compararSerie(serie, alvo),
      meta:
        meta !== undefined
          ? { id: meta.id, alvo: meta.targetValue.toNumber(), deadline: meta.deadline }
          : null,
    };
  }

  /**
   * Fuso da unidade do aluno.
   *
   * 404 quando o aluno nao existe -- ou e de outro tenant, que da no mesmo
   * daqui de fora (INV-006: nao vazar existencia entre academias).
   */
  private async fusoDoAluno(contexto: TenantContext, studentId: string): Promise<string> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    const unidade = await this.unidades.encontrar(contexto, aluno.gymUnitId);

    if (unidade === null) {
      // Aluno sempre tem unidade (`gym_unit_id` e NOT NULL). Chegar aqui e
      // dado inconsistente, nao caso de uso -- e cair em UTC esconderia isso
      // atras de um grafico levemente errado.
      throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
    }

    return unidade.timezone;
  }
}

/**
 * Valor CANONICO do tipo naquela avaliacao, ou `null` se ela nao o mediu.
 *
 * `null` e nao `0` (INV-104): uma avaliacao so de circunferencia nao tem
 * peso, e tratar isso como zero faria o grafico despencar num dia em que
 * ninguem pesou o aluno.
 *
 * `toNumber()` aqui e na BORDA (INV-106): o `Decimal` do banco preserva a
 * precisao ate este ponto, e o dominio compara com a precisao que recebe.
 */
function valorCanonico(
  medidas: readonly BodyMeasurement[],
  tipo: TipoDeMedida,
): number | null {
  const medida = medidas.find((m) => m.type === tipo);

  return medida ? medida.canonicalValue.toNumber() : null;
}

/** Unidade canonica com que o tipo foi gravado, se alguma avaliacao o mediu. */
function unidadeDoTipo(
  publicadas: readonly AvaliacaoPublicada[],
  tipo: TipoDeMedida,
): string | null {
  for (const avaliacao of publicadas) {
    const medida = avaliacao.measurements.find((m) => m.type === tipo);

    if (medida) return medida.canonicalUnit?.toLowerCase() ?? null;
  }

  return null;
}
