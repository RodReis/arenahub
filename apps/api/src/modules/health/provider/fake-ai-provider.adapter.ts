import { Injectable } from '@nestjs/common';

import type { SnapshotDeAnalise } from '../domain/snapshot-de-analise.js';
import {
  ErroDaIa,
  type AiProvider,
  type PedidoDeAnalise,
  type RespostaDaIa,
} from './ai-provider.port.js';

/**
 * Dublê do provedor de IA, no BOUNDARY (`docs/TESTING.md` 3).
 *
 * NAO E CODIGO DE TESTE QUE VAZOU PARA PRODUCAO -- e o adapter que responde
 * enquanto o contrato do ADR-036 decisao 3 (clausula de nao-treinamento) nao
 * estiver firmado. Ate la, a fatia inteira funciona ponta a ponta sem que um
 * unico numero de aluno atravesse a fronteira do pais.
 *
 * A saida e DETERMINISTICA e derivada do snapshot: mesma entrada, mesma
 * analise. Isso importa mais do que parece -- o aceite da Slice 3.5 exige que
 * a analise "possa ser reproduzida dentro das limitacoes do modelo", e um
 * fake que sorteasse texto tornaria todo teste de integracao instavel.
 *
 * O texto que ele gera cita SO numeros que estao no snapshot e evita
 * vocabulario clinico -- ou seja, passa pela propria validacao da regra no 8.
 * Um fake que produzisse saida invalida faria o caminho feliz nunca ser
 * exercitado.
 */
@Injectable()
export class FakeAiProviderAdapter implements AiProvider {
  /**
   * Modo de falha, para o teste exercitar o `M3-NFR-004` (indisponibilidade
   * de IA nao impede avaliacao manual).
   *
   * Instancia compartilhada na suite: ligar isto num bloco e esquecer de
   * desligar contamina o proximo. Por isso o `resetar()` existe e os testes
   * o chamam em `afterEach`.
   */
  private falhaProgramada: ErroDaIa | null = null;

  programarFalha(erro: ErroDaIa): void {
    this.falhaProgramada = erro;
  }

  resetar(): void {
    this.falhaProgramada = null;
  }

  analisar(pedido: PedidoDeAnalise): Promise<RespostaDaIa> {
    if (this.falhaProgramada) {
      return Promise.reject(this.falhaProgramada);
    }

    const snapshot = pedido.snapshot;

    return Promise.resolve({
      bruta: snapshot.analysisBlocked ? bloqueada(snapshot) : analise(snapshot),
      model: 'fake-ai-provider',
      // Zero de proposito: fake nao gasta, e somar custo ficticio ao teto do
      // tenant faria o `M3-NFR-005` disparar em desenvolvimento.
      costMicros: 0,
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
  }
}

/**
 * Analise bloqueada (ADR-037: gestacao).
 *
 * Vazia de conteudo, com o flag ligado -- exatamente o que `validarSaida`
 * exige. A avaliacao continua registrada e comparavel; o que nao acontece e
 * interpretar.
 */
function bloqueada(snapshot: SnapshotDeAnalise): unknown {
  return {
    summary: '',
    progress: [],
    positivePoints: [],
    attentionPoints: [],
    trends: [],
    goalProgress: [],
    questionsForProfessional: [],
    disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
    pendingMedicalReferral: snapshot.pendingMedicalReferral,
    pendingReferralSince: snapshot.pendingReferralSince,
    contextFactors: [...snapshot.contextFactors],
    suppressedFindings: [],
    analysisBlocked: true,
  };
}

function analise(snapshot: SnapshotDeAnalise): unknown {
  const primeira = snapshot.assessments[0];
  const ultima = snapshot.assessments[snapshot.assessments.length - 1];

  const peso = (indice: 'primeira' | 'ultima'): number | null => {
    const alvo = indice === 'primeira' ? primeira : ultima;

    return alvo?.measurements.find((m) => m.type === 'WEIGHT')?.value ?? null;
  };

  const de = peso('primeira');
  const para = peso('ultima');

  const progress =
    de !== null && para !== null && snapshot.assessments.length > 1
      ? [
          {
            metric: 'WEIGHT',
            // So numeros do snapshot -- e o que a validacao confere.
            observation: `O peso foi de ${de} para ${para}.`,
          },
        ]
      : [];

  const positivePoints: string[] = [];

  if (snapshot.attendance.confirmedSource && snapshot.attendance.totalSessions > 0) {
    positivePoints.push(
      `Voce registrou ${snapshot.attendance.totalSessions} dias de treino no periodo.`,
    );
  }

  if (snapshot.goals.some((meta) => meta.fraction !== null && meta.fraction > 0)) {
    positivePoints.push('Houve avanco em direcao a meta combinada.');
  }

  const attentionPoints: string[] = [];

  if (!snapshot.attendance.confirmedSource) {
    // Nao afirma que o aluno faltou: a fonte pode ter falhado (F20).
    attentionPoints.push('Nao ha registro confirmado de frequencia no periodo.');
  }

  if (snapshot.pendingMedicalReferral) {
    // ADR-035 decisao 6: texto FIXO, igual para qualquer achado e qualquer
    // aluno. Igual para todos = nao personalizado = nao clinico. O fake nao
    // sabe qual e o achado, e essa ignorancia e o desenho.
    attentionPoints.push(
      'Ha um encaminhamento medico pendente registrado na sua ficha. Procure o profissional de saude.',
    );
  }

  return {
    summary:
      snapshot.assessments.length > 1
        ? 'Sua composicao corporal foi acompanhada ao longo do periodo.'
        : 'Esta e a sua primeira avaliacao registrada no periodo.',
    progress,
    positivePoints,
    attentionPoints,
    trends:
      de !== null && para !== null
        ? [{ metric: 'WEIGHT', direction: para < de ? 'DOWN' : para > de ? 'UP' : 'STABLE' }]
        : [],
    goalProgress: snapshot.goals.map(
      (meta) => `Meta de ${meta.type.toLowerCase()}: alvo de ${meta.target}.`,
    ),
    questionsForProfessional: ['Vale revisar as metas na proxima avaliacao?'],
    disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
    pendingMedicalReferral: snapshot.pendingMedicalReferral,
    pendingReferralSince: snapshot.pendingReferralSince,
    contextFactors: [...snapshot.contextFactors],
    suppressedFindings: snapshot.suppressedFindings.map((achado) => ({
      metric: achado,
      reason: 'suprimido por fator de contexto do aluno',
    })),
    analysisBlocked: false,
  };
}
