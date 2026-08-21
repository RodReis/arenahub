import { Injectable, NotFoundException } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { StudentRepository } from '../students/student.repository.js';
import { AttendanceRepository } from './attendance.repository.js';
import { AssessmentRepository, type AvaliacaoPublicada } from './assessment.repository.js';
import { GoalRepository } from './goal.repository.js';
import {
  agregarFrequencia,
  consistencia,
  POLITICA_DE_SESSAO,
  projetarSessoes,
  type BaldeDeFrequencia,
  type Granularidade,
  type SessaoProjetada,
} from './domain/frequencia.js';
import { calcularProgresso, type ProgressoDaMeta } from './domain/progresso-da-meta.js';
import { dataLocalIso, inicioDoPeriodo, type Periodo } from './domain/periodo.js';
import type { TipoDeMedida } from './domain/medida.js';

/**
 * Frequencia e progresso de metas (F20, Slice 3.4).
 *
 * Este arquivo e a FRONTEIRA: daqui para dentro do dominio nao existe Prisma,
 * relogio nem fuso. Todo o I/O acontece aqui, e o que segue para
 * `projetarSessoes`/`calcularProgresso` e estrutura inerte -- mesmo desenho de
 * `HealthProgressService` (F18).
 *
 * O fuso vem da UNIDADE do aluno (ADR-019, sem fallback para UTC): assumir um
 * faria a sessao da noite cair no dia seguinte, inflando a frequencia de quem
 * treina tarde -- que e a maioria.
 */

/**
 * Qualidade do dado por tras dos numeros (aceite da Slice 3.4: "deixam
 * limitacoes explicitas").
 *
 * Existe porque frequencia zero tem DUAS causas que pedem acoes opostas: o
 * aluno nao veio, ou o sistema nao viu. Sem este campo a tela nao consegue
 * distinguir "faltou" de "a catraca nao estava registrando", e a recepcao
 * cobraria presenca de quem esteve la.
 */
export type QualidadeDoDado =
  /** Ha passagem confirmada no periodo -- os numeros descrevem o que houve. */
  | 'CONFIRMADA'
  /**
   * Nenhuma passagem confirmada no periodo inteiro. Pode ser ausencia real ou
   * fonte ausente, e daqui NAO da para saber qual: enquanto a catraca opera
   * liberada nos dois sentidos (ADR-029), ninguem confirma giro nenhum.
   */
  | 'SEM_FONTE_CONFIRMADA';

export interface FrequenciaDoAluno {
  readonly periodo: Periodo;
  readonly granularidade: Granularidade;
  readonly fuso: string;
  readonly policyVersion: string;
  readonly qualidade: QualidadeDoDado;
  readonly totalDeSessoes: number;
  readonly totalDePassagens: number;
  readonly baldes: readonly BaldeDeFrequencia[];
  readonly consistencia: {
    readonly semanasComSessao: number;
    readonly semanasElegiveis: number;
    readonly proporcao: number | null;
  };
  /**
   * NAO ha duracao media nem tempo de permanencia, e a ausencia e o ponto --
   * ver o bloco do topo de `domain/frequencia.ts`.
   */
  readonly sessoes: readonly SessaoProjetada[];
}

export interface MetaComProgresso {
  readonly id: string;
  readonly type: TipoDeMedida;
  readonly unidade: string | null;
  readonly deadline: Date;
  readonly progresso: ProgressoDaMeta;
}

const SEMANA_EM_MS = 7 * 86_400_000;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly frequencia: AttendanceRepository,
    private readonly avaliacoes: AssessmentRepository,
    private readonly metas: GoalRepository,
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
  ) {}

  /**
   * Frequencia do aluno no periodo.
   *
   * PROJETA ANTES DE LER, de proposito: a sessao e uma projecao, e uma
   * projecao desatualizada e pior que nenhuma -- mostraria "treinou 2x" para
   * quem treinou 3, e o aluno confiaria no numero. Como a gravacao e
   * idempotente (chave unica no banco), projetar a cada consulta e seguro; se
   * o volume exigir, isto vira job sem mudar o resultado, que e justamente o
   * que a idempotencia compra.
   */
  async frequenciaDoAluno(
    contexto: TenantContext,
    studentId: string,
    periodo: Periodo,
    granularidade: Granularidade,
    agora: Date,
  ): Promise<FrequenciaDoAluno> {
    const fuso = await this.fusoDoAluno(contexto, studentId);
    const desde = inicioDoPeriodo(periodo, agora, fuso);

    const passagens = await this.frequencia.passagensElegiveis(contexto, studentId, desde, agora);
    const projetadas = projetarSessoes(passagens, fuso, dataLocalIso);

    await this.frequencia.gravarSessoes(contexto, studentId, projetadas);

    // Le de volta em vez de usar `projetadas`: o periodo pode conter sessoes
    // gravadas por uma execucao anterior a partir de passagens que hoje nao
    // estao mais na janela consultada. Confiar so no que acabou de ser
    // projetado perderia essas.
    const sessoes = await this.frequencia.listarSessoes(contexto, studentId, desde, agora);

    const baldes = agregarFrequencia(sessoes, granularidade);
    const semanas = this.semanasElegiveis(desde, agora, sessoes);

    return {
      periodo,
      granularidade,
      fuso,
      policyVersion: POLITICA_DE_SESSAO,
      qualidade: sessoes.length > 0 ? 'CONFIRMADA' : 'SEM_FONTE_CONFIRMADA',
      totalDeSessoes: sessoes.length,
      totalDePassagens: sessoes.reduce((soma, s) => soma + s.passagens, 0),
      baldes,
      consistencia: consistencia(sessoes, semanas),
      sessoes,
    };
  }

  /**
   * Metas ativas do aluno, com progresso calculado contra a ultima medicao.
   *
   * "Progresso calculado, SEM EDITAR AVALIACOES" (Slice 3.4): o calculo le a
   * serie publicada e a baseline congelada na meta; nenhuma avaliacao e
   * tocada. Se um dia isto precisar escrever, a escrita e outra fatia -- e
   * outra decisao.
   */
  async metasComProgresso(
    contexto: TenantContext,
    studentId: string,
    agora: Date,
  ): Promise<readonly MetaComProgresso[]> {
    // Valida o aluno antes de qualquer leitura: 404 aqui e o mesmo 404 de
    // aluno de outro tenant (INV-006, nao vazar existencia entre academias).
    await this.fusoDoAluno(contexto, studentId);

    const [metas, publicadas] = await Promise.all([
      this.metas.listarAtivas(contexto, studentId),
      // `null` = todo o periodo: a ultima medicao de um tipo pode ser
      // anterior a qualquer janela, e a meta compara com ela mesmo assim.
      this.avaliacoes.listarPublicadasDoAluno(contexto, studentId, null),
    ]);

    return metas.map((meta) => ({
      id: meta.id,
      type: meta.type.toLowerCase() as TipoDeMedida,
      unidade: meta.unit === null ? null : meta.unit.toLowerCase(),
      deadline: meta.deadline,
      progresso: calcularProgresso(
        {
          baseline: meta.baselineValue.toNumber(),
          alvo: meta.targetValue.toNumber(),
          prazo: meta.deadline,
          achievedAt: meta.achievedAt,
        },
        ultimoValorPublicado(publicadas, meta.type.toLowerCase() as TipoDeMedida),
        agora,
      ),
    }));
  }

  /**
   * Quantas semanas o periodo abrange -- o denominador da consistencia.
   *
   * Vem daqui e nao do dominio porque so a fronteira conhece o "agora" e o
   * corte do periodo. Em `ALL` nao ha corte, entao o denominador e a distancia
   * da PRIMEIRA sessao ate agora: usar uma data fixa produziria consistencia
   * ridicula para quem entrou na academia mes passado.
   */
  private semanasElegiveis(
    desde: Date | null,
    agora: Date,
    sessoes: readonly SessaoProjetada[],
  ): number {
    const inicio = desde ?? sessoes[0]?.primeiraEm ?? null;

    if (inicio === null) return 0;

    // `ceil` e nao `round`: uma semana comecada ja e uma semana em que o aluno
    // podia ter vindo. Arredondar para baixo daria 0 para quem consulta na
    // terca-feira da primeira semana, e a divisao devolveria `null` como se
    // nao houvesse periodo.
    return Math.max(1, Math.ceil((agora.getTime() - inicio.getTime()) / SEMANA_EM_MS));
  }

  /** Mesma regra de `HealthProgressService`: fuso da unidade, sem fallback. */
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

/**
 * Ultimo valor publicado de um tipo, ou `null` se o aluno nunca o mediu.
 *
 * Percorre da mais recente para a mais antiga e para na primeira que tem o
 * tipo: uma avaliacao so de circunferencia nao "zera" o peso do aluno, ela
 * apenas nao fala dele (INV-104).
 *
 * Descarta avaliacao ja corrigida (`supersededById`) pela mesma razao da F18:
 * a original continua publicada como prova de que o numero errado circulou,
 * mas quem vale na serie e a folha da cadeia.
 */
function ultimoValorPublicado(
  publicadas: readonly AvaliacaoPublicada[],
  tipo: TipoDeMedida,
): number | null {
  const folhas = publicadas
    .filter((a) => a.supersededBy === null)
    .sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime() || b.id.localeCompare(a.id));

  for (const avaliacao of folhas) {
    const medida = avaliacao.measurements.find((m) => m.type.toLowerCase() === tipo);

    // `toNumber()` na BORDA (INV-106): o `Decimal` preserva a precisao ate
    // aqui, e o dominio compara com a precisao que recebe.
    if (medida) return medida.canonicalValue.toNumber();
  }

  return null;
}
