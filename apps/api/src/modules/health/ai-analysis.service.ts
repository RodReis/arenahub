import { randomBytes } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { StudentRepository } from '../students/student.repository.js';
import { AiAnalysisRepository } from './ai-analysis.repository.js';
import { AssessmentRepository } from './assessment.repository.js';
import { AttendanceService } from './attendance.service.js';
import { HealthProgressService } from './health-progress.service.js';
import { analiseBloqueada, avisosSuprimidos } from './domain/contexto-de-saude.js';
import { avaliarAceite } from './domain/aceite-da-analise.js';
import { calcularIdadeEmAnos } from '../privacy/domain/consentimento.js';
import {
  conferirPseudonimizacao,
  montarSnapshot,
  type SnapshotDeAnalise,
} from './domain/snapshot-de-analise.js';
import {
  numerosDoSnapshot,
  validarSaida,
  type SaidaDaAnalise,
} from './domain/saida-da-analise.js';
import { dataLocalIso } from './domain/periodo.js';
import { AI_PROVIDER, ErroDaIa, type AiProvider } from './provider/ai-provider.port.js';
import { PROMPT_DE_ANALISE } from './prompt-de-analise.js';
import type { TipoDeMedida } from './domain/medida.js';

/**
 * Analise assistiva por IA (F21, Slice 3.5).
 *
 * Este arquivo e a FRONTEIRA, e nesta fatia ela e mais que uma convencao de
 * arquitetura: e o ponto onde o dado do aluno atravessa a fronteira do PAIS.
 * A ordem das operacoes aqui e a defesa:
 *

 * Inverter 1 e 2 mandaria dado de quem nao consentiu. Pular 3 tornaria a
 * pseudonimizacao uma declaracao em vez de uma garantia. Pular 5 publicaria
 * diagnostico -- que e o que a regra de arquitetura no 8 proibe.
 */

export interface ResultadoDaAnalise {
  readonly id: string;
  readonly status: 'PUBLISHED' | 'REJECTED' | 'FAILED';
  readonly saida: SaidaDaAnalise | null;
  readonly motivoDaRecusa: string | null;
}

@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly analises: AiAnalysisRepository,
    private readonly avaliacoes: AssessmentRepository,
    private readonly progresso: HealthProgressService,
    private readonly frequencia: AttendanceService,
    private readonly alunos: StudentRepository,
    @Inject(AI_PROVIDER) private readonly provedor: AiProvider,
  ) {}

  /**
   * Gera a analise de um aluno.
   *
   * `agora` entra por parametro: a idade que decide a revalidacao do aceite
   * (INV-143) e a janela da frequencia dependem dele, e funcao que le o
   * relogio nao e testavel na virada dos 18.
   */
  async gerar(
    contexto: TenantContext,
    studentId: string,
    solicitanteId: string,
    agora: Date,
  ): Promise<ResultadoDaAnalise> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    // 404 e nao 403 tambem para aluno de outro tenant: 403 vazaria que aquele
    // id existe em algum lugar (INV-006).
    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    // --- 1. O ACEITE, ANTES DE QUALQUER LEITURA DE DADO DE SAUDE ---------
    const assinaturas = await this.analises.assinaturasDoAceite(contexto, studentId);
    const idade = calcularIdadeEmAnos(aluno.birthDate, agora);
    const aceite = avaliarAceite(assinaturas, idade);

    if (!aceite.autorizado) {
      // 403 e o codigo certo aqui: o aluno existe e quem pergunta pode ve-lo
      // -- o que falta e autorizacao para ESTE tratamento especifico.
      throw new ForbiddenException({ code: aceite.motivo });
    }

    // --- 2. O SNAPSHOT ---------------------------------------------------
    const snapshot = await this.montar(contexto, studentId, aluno, agora);

    // --- 3. A CONFERENCIA, ANTES DO ENVIO --------------------------------
    // Falha alto: snapshot com PII nao pode ser "corrigido" no caminho.
    conferirPseudonimizacao(snapshot);

    const promptVersionId = await this.analises.versaoDePromptVigente(PROMPT_DE_ANALISE);

    // --- 4. O PROVEDOR ---------------------------------------------------
    let resposta;

    try {
      resposta = await this.provedor.analisar({
        snapshot,
        prompt: PROMPT_DE_ANALISE.content,
        promptName: PROMPT_DE_ANALISE.name,
      });
    } catch (erro) {
      // `M3-NFR-004`: indisponibilidade de IA nao impede avaliacao manual. A
      // falha vira LINHA, nao excecao que sobe -- sem o registro, o teto de
      // gasto e o circuit breaker do `M3-NFR-005` nao teriam o que contar.
      const daIa = erro instanceof ErroDaIa ? erro : null;

      const registro = await this.analises.registrar(contexto, {
        studentId,
        status: 'FAILED',
        analysisRef: snapshot.analysisRef,
        snapshot,
        output: null,
        rejectionReason: daIa?.codigo ?? 'AI_PROVIDER_UNAVAILABLE',
        rejectionDetail: daIa?.message ?? 'falha nao classificada do provedor',
        promptVersionId,
        model: 'unknown',
        costMicros: 0,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestedByUserId: solicitanteId,
      });

      return {
        id: registro.id,
        status: 'FAILED',
        saida: null,
        motivoDaRecusa: daIa?.codigo ?? 'AI_PROVIDER_UNAVAILABLE',
      };
    }

    // --- 5. A VALIDACAO --------------------------------------------------
    const validacao = validarSaida(resposta.bruta, {
      numerosPermitidos: numerosDoSnapshot(snapshot),
      metricasSuprimidas: metricasDosAvisos(snapshot.suppressedFindings),
      analiseBloqueada: snapshot.analysisBlocked,
    });

    // --- 6. O REGISTRO, aceita ou nao ------------------------------------
    const comum = {
      studentId,
      analysisRef: snapshot.analysisRef,
      snapshot,
      promptVersionId,
      model: resposta.model,
      costMicros: resposta.costMicros,
      latencyMs: resposta.latencyMs,
      inputTokens: resposta.inputTokens,
      outputTokens: resposta.outputTokens,
      requestedByUserId: solicitanteId,
    };

    if (!validacao.aceita) {
      // `M3-AC-008`: saida com diagnostico e REJEITADA E REGISTRADA. A linha
      // fica sem `output` -- a constraint do banco garante que o texto
      // recusado nao entra "para consulta".
      const registro = await this.analises.registrar(contexto, {
        ...comum,
        status: 'REJECTED',
        output: null,
        rejectionReason: validacao.motivo,
        rejectionDetail: validacao.detalhe,
      });

      return {
        id: registro.id,
        status: 'REJECTED',
        saida: null,
        motivoDaRecusa: validacao.motivo,
      };
    }

    const registro = await this.analises.registrar(contexto, {
      ...comum,
      status: 'PUBLISHED',
      output: validacao.saida,
      rejectionReason: null,
      rejectionDetail: null,
    });

    return { id: registro.id, status: 'PUBLISHED', saida: validacao.saida, motivoDaRecusa: null };
  }
  /**
   * O estado do aceite, SEM gerar nada.
   *
   * A tela precisa distinguir tres coisas que hoje parecem iguais ("nenhuma
   * analise publicada"): o aluno nunca fez avaliacao, o aluno nunca
   * consentiu, ou o aluno recusou. So a primeira e um estado normal de
   * espera -- as outras duas exigem ACAO de quem opera, e uma tela que as
   * achata em silencio faz a recepcao esperar por algo que nunca vai chegar
   * sozinho.
   *
   * Le a MESMA `avaliarAceite` que `gerar` usa: um segundo criterio aqui
   * diria "pode" onde a geracao diz "nao pode".
   */
  async estadoDoAceite(
    contexto: TenantContext,
    studentId: string,
    agora: Date,
  ): Promise<{ autorizado: boolean; motivo: string | null }> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const assinaturas = await this.analises.assinaturasDoAceite(contexto, studentId);
    const aceite = avaliarAceite(assinaturas, calcularIdadeEmAnos(aluno.birthDate, agora));

    return aceite.autorizado
      ? { autorizado: true, motivo: null }
      : { autorizado: false, motivo: aceite.motivo };
  }


  /** A ultima analise PUBLICADA do aluno -- o que totem e app consomem. */
  async ultimaPublicada(
    contexto: TenantContext,
    studentId: string,
  ): Promise<{
    id: string;
    saida: SaidaDaAnalise;
    geradaEm: Date;
    model: string;
    promptVersion: string;
  } | null> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    return this.analises.ultimaPublicada(contexto, studentId);
  }

  private async montar(
    contexto: TenantContext,
    studentId: string,
    aluno: { birthDate: Date; registeredSex: string | null },
    agora: Date,
  ): Promise<SnapshotDeAnalise> {
    const [publicadas, fatores, metas, frequencia] = await Promise.all([
      this.avaliacoes.listarPublicadasDoAluno(contexto, studentId, null),
      this.avaliacoes.listarContextoAtivo(contexto, studentId),
      this.frequencia.metasComProgresso(contexto, studentId, agora),
      this.frequencia.frequenciaDoAluno(contexto, studentId, '90D', 'SEMANAL', agora),
    ]);

    // Sem `as`: o enum do Prisma ja e exatamente `FatorDeContexto`, e a
    // assercao esconderia uma divergencia futura entre os dois em vez de
    // deixar o compilador apontar.
    const ativos = fatores.map((f) => f.factor);

    return montarSnapshot({
      // 16 bytes de aleatoriedade: identificador OPACO, sem relacao derivavel
      // com o aluno. Derivar de `studentId` (hash, por exemplo) produziria
      // rotulo ESTAVEL entre chamadas, que reidentifica por correlacao.
      analysisRef: `an_${randomBytes(16).toString('hex')}`,
      aluno: {
        birthDate: aluno.birthDate,
        biologicalSex: paraSexo(aluno.registeredSex),
      },
      avaliacoes: publicadas
        .filter((a) => a.supersededBy === null)
        .sort((a, b) => a.assessedAt.getTime() - b.assessedAt.getTime())
        .map((a) => ({
          assessedAtLocal: dataLocalIso(a.assessedAt, frequencia.fuso),
          measurements: a.measurements.map((m) => ({
            type: m.type.toLowerCase() as TipoDeMedida,
            value: m.canonicalValue.toNumber(),
            // `canonicalUnit` e nao `originalUnit`: a serie compara valores,
            // e libras ao lado de quilos na mesma metrica confundiria o
            // modelo tanto quanto confundiria uma pessoa (INV-105).
            unit: m.canonicalUnit === null ? null : m.canonicalUnit.toLowerCase(),
          })),
        })),
      metas: metas.map((meta) => ({
        type: meta.type,
        baseline: meta.progresso.baseline,
        target: meta.progresso.alvo,
        unit: meta.unidade,
        fraction: meta.progresso.fracao,
      })),
      frequencia: {
        totalSessions: frequencia.totalDeSessoes,
        consistencyRatio: frequencia.consistencia.proporcao,
        confirmedSource: frequencia.qualidade === 'CONFIRMADA',
      },
      fatores: ativos,
      suprimidos: avisosSuprimidos(ativos),
      analiseBloqueada: analiseBloqueada(ativos),
      // TODO(F19): a pendencia medica nasce do parser de ECG, que e da F19.
      // Ate la e sempre `false` -- e o campo existe porque o ADR-035 exige
      // que a IA SAIBA que ha pendencia, e ligar isso depois nao pode mexer
      // no formato do snapshot ja gravado.
      pendenciaMedicaAberta: false,
      pendenciaDesde: null,
      agora,
    });
  }
}

function paraSexo(registrado: string | null): 'MALE' | 'FEMALE' | 'UNDECLARED' | null {
  if (registrado === 'MALE' || registrado === 'FEMALE') return registrado;

  return 'UNDECLARED';
}

/**
 * Avisos suprimidos, traduzidos para a METRICA que eles descrevem.
 *
 * O validador confere se a prosa reintroduziu um achado suprimido, e ele
 * raciocina em metrica -- nao em codigo de aviso.
 */
function metricasDosAvisos(avisos: readonly string[]): TipoDeMedida[] {
  const mapa: Record<string, TipoDeMedida> = {
    BODY_FAT_PERCENT_HIGH: 'BODY_FAT_PERCENT',
    LEAN_BODY_MASS_HIGH: 'LEAN_BODY_MASS',
    SKELETAL_MUSCLE_MASS_HIGH: 'SKELETAL_MUSCLE_MASS',
    TOTAL_BODY_WATER_HIGH: 'TOTAL_BODY_WATER',
    INTRACELLULAR_WATER_HIGH: 'INTRACELLULAR_WATER',
    EXTRACELLULAR_WATER_HIGH: 'EXTRACELLULAR_WATER',
    PROTEIN_MASS_HIGH: 'PROTEIN_MASS',
    MINERAL_MASS_HIGH: 'MINERAL_MASS',
  };

  return avisos.flatMap((aviso) => {
    const metrica = mapa[aviso];

    return metrica ? [metrica] : [];
  });
}
