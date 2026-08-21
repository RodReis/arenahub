import { describe, expect, it } from '@jest/globals';

import {
  numerosDoSnapshot,
  validarSaida,
  type ContextoDaValidacao,
  type SaidaDaAnalise,
} from './saida-da-analise.js';

function saida(sobrescreve: Partial<SaidaDaAnalise> = {}): SaidaDaAnalise {
  return {
    summary: 'Sua composicao corporal evoluiu no periodo.',
    progress: [{ metric: 'WEIGHT', observation: 'O peso caiu de 90 para 85.' }],
    positivePoints: ['Frequencia constante nas ultimas semanas.'],
    attentionPoints: ['A gordura corporal ficou estavel.'],
    trends: [{ metric: 'WEIGHT', direction: 'DOWN' }],
    goalProgress: ['Metade do caminho ate a meta de peso.'],
    questionsForProfessional: ['Vale revisar a meta de peso?'],
    disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
    pendingMedicalReferral: false,
    pendingReferralSince: null,
    contextFactors: [],
    suppressedFindings: [],
    analysisBlocked: false,
    ...sobrescreve,
  };
}

function contexto(sobrescreve: Partial<ContextoDaValidacao> = {}): ContextoDaValidacao {
  return {
    numerosPermitidos: [90, 85, 24.1, 22.3, 0.5, 50],
    metricasSuprimidas: [],
    analiseBloqueada: false,
    ...sobrescreve,
  };
}

describe('validarSaida -- schema (M3-BR-010)', () => {
  it('aceita saida completa e bem formada', () => {
    expect(validarSaida(saida(), contexto()).aceita).toBe(true);
  });

  /**
   * O `disclaimerCode` e literal, nao "alguma string". Aceitar qualquer texto
   * esvaziaria a regra de arquitetura no 8, que exige o codigo exato.
   */
  it('recusa saida sem o disclaimer exato', () => {
    const semDisclaimer = { ...saida(), disclaimerCode: 'OK' };
    const resultado = validarSaida(semDisclaimer, contexto());

    expect(resultado).toMatchObject({ aceita: false, motivo: 'SCHEMA_INVALID' });
  });

  it('recusa objeto que nao e a saida esperada', () => {
    expect(validarSaida(null, contexto())).toMatchObject({ motivo: 'SCHEMA_INVALID' });
    expect(validarSaida('texto', contexto())).toMatchObject({ motivo: 'SCHEMA_INVALID' });
    expect(validarSaida({ summary: 'so isso' }, contexto())).toMatchObject({
      motivo: 'SCHEMA_INVALID',
    });
  });

  it('recusa direcao de tendencia fora do enum', () => {
    const invalida = { ...saida(), trends: [{ metric: 'WEIGHT', direction: 'CAINDO' }] };

    expect(validarSaida(invalida, contexto())).toMatchObject({ motivo: 'SCHEMA_INVALID' });
  });
});

describe('validarSaida -- diagnostico e conduta (regra no 8, M3-AC-008)', () => {
  it.each([
    ['classificacao clinica', 'Voce tem obesidade grau 1.'],
    ['doenca nomeada', 'Os dados sugerem uma sindrome metabolica.'],
    ['achado cardiaco', 'Ha sinais de fibrilacao atrial no seu quadro.'],
    ['prescricao de treino', 'Faca 4 series de 12 repeticoes tres vezes por semana.'],
    ['prescricao de dieta', 'Consuma 1800 kcal por dia.'],
    ['conduta', 'Recomendo iniciar suplementacao imediatamente.'],
    ['tranquilizacao clinica', 'Nao ha risco nenhum na sua saude.'],
  ])('recusa %s', (_rotulo, texto) => {
    const resultado = validarSaida(saida({ summary: texto }), contexto());

    expect(resultado).toMatchObject({ aceita: false, motivo: 'DIAGNOSTIC_LANGUAGE' });
  });

  it('procura diagnostico em TODA a prosa, nao so no resumo', () => {
    // Um modelo que aprende a manter o `summary` limpo escreveria a frase
    // proibida no ponto de atencao.
    const resultado = validarSaida(
      saida({ attentionPoints: ['Voce apresenta um quadro de desnutricao.'] }),
      contexto(),
    );

    expect(resultado).toMatchObject({ motivo: 'DIAGNOSTIC_LANGUAGE' });
  });

  /**
   * A lista mira o ATO, nao o assunto: falar de gordura corporal e o proposito
   * do produto. Se estes casos falharem, o validador virou censura e o produto
   * nao consegue dizer nada util.
   */
  it.each([
    'A gordura corporal caiu 2 pontos no periodo.',
    'Sua massa muscular esqueletica subiu.',
    'A agua corporal total esta acima da faixa do equipamento.',
    'Vale conversar com o profissional sobre a meta.',
  ])('aceita prosa legitima: %s', (texto) => {
    expect(validarSaida(saida({ summary: texto }), contexto()).aceita).toBe(true);
  });

  it('o detalhe da rejeicao diz o que foi rejeitado, para a auditoria', () => {
    const resultado = validarSaida(saida({ summary: 'Voce tem obesidade.' }), contexto());

    // `M3-AC-008` exige registrar a rejeicao. Sem o trecho, a auditoria nao
    // consegue dizer o que o modelo escreveu -- e o texto e do modelo, nao
    // dado pessoal do aluno.
    expect(resultado.aceita).toBe(false);
    if (!resultado.aceita) expect(resultado.detalhe).toContain('obesidade');
  });
});

describe('validarSaida -- valor inexistente', () => {
  /**
   * A metade esquecida do `M3-BR-010`. Numero inventado e mais perigoso que
   * diagnostico: o diagnostico o avaliador percebe, o numero errado ele
   * repassa ao aluno.
   */
  it('recusa numero que nao existe no snapshot', () => {
    const resultado = validarSaida(
      saida({ summary: 'Sua gordura caiu de 24,1% para 21,8%.' }),
      contexto(),
    );

    expect(resultado).toMatchObject({ aceita: false, motivo: 'VALUE_NOT_IN_SNAPSHOT' });
    if (!resultado.aceita) expect(resultado.detalhe).toContain('21,8');
  });

  it('aceita numero que existe, escrito com virgula ou ponto', () => {
    expect(
      validarSaida(saida({ summary: 'A gordura foi de 24,1 para 22,3.' }), contexto()).aceita,
    ).toBe(true);
    expect(
      validarSaida(saida({ summary: 'A gordura foi de 24.1 para 22.3.' }), contexto()).aceita,
    ).toBe(true);
  });

  it('tolera arredondamento pequeno', () => {
    // O modelo escreve 22,3 quando o snapshot tem 22,32 -- e a mesma medida.
    // A saida e reduzida ao essencial: a de exemplo cita 90 e 85 na prosa, e
    // eles nao estariam nesta lista curta de permitidos.
    const soOResumo = saida({
      summary: 'Chegou a 22,3.',
      progress: [],
      positivePoints: [],
      attentionPoints: [],
      goalProgress: [],
      questionsForProfessional: [],
    });

    expect(validarSaida(soOResumo, contexto({ numerosPermitidos: [22.32] })).aceita).toBe(true);
  });

  it('nao rejeita contagem pequena nem ano', () => {
    // "treinou 3 vezes" e "desde 2026" sao prosa correta, nao medida.
    expect(
      validarSaida(saida({ summary: 'Voce treinou 3 vezes desde 2026.' }), contexto()).aceita,
    ).toBe(true);
  });

  it('confere numero citado em qualquer parte da prosa', () => {
    const resultado = validarSaida(
      saida({ goalProgress: ['Faltam 7,4 kg para a meta.'] }),
      contexto(),
    );

    expect(resultado).toMatchObject({ motivo: 'VALUE_NOT_IN_SNAPSHOT' });
  });
});

describe('validarSaida -- ADR-037', () => {
  /**
   * O modelo recebeu a lista de suprimidos e mesmo assim escreveu sobre eles.
   * Sem esta checagem, o alarme falso que a regra deterministica matou volta
   * em prosa -- e o produto e abandonado na terceira semana, que e o modo de
   * falha que o ADR-037 existe para evitar.
   */
  it('recusa ponto de atencao sobre metrica que a regra suprimiu', () => {
    const resultado = validarSaida(
      saida({ attentionPoints: ['A agua intracelular esta acima do esperado.'] }),
      contexto({ metricasSuprimidas: ['INTRACELLULAR_WATER'] }),
    );

    expect(resultado).toMatchObject({
      aceita: false,
      motivo: 'SUPPRESSED_FINDING_REINTRODUCED',
    });
  });

  it('a mesma metrica fora dos pontos de atencao NAO e rejeitada', () => {
    // Descrever a evolucao e legitimo; transformar em ALERTA e o que a regra
    // suprimiu.
    const resultado = validarSaida(
      saida({
        attentionPoints: [],
        progress: [{ metric: 'INTRACELLULAR_WATER', observation: 'Manteve-se estavel.' }],
      }),
      contexto({ metricasSuprimidas: ['INTRACELLULAR_WATER'] }),
    );

    expect(resultado.aceita).toBe(true);
  });

  it('analise bloqueada com prosa e recusada', () => {
    const resultado = validarSaida(
      saida({ analysisBlocked: true }),
      contexto({ analiseBloqueada: true }),
    );

    // Gestacao bloqueia a analise INTEIRA: escrever mesmo assim e interpretar
    // uma medicao que o produto declarou nao interpretavel.
    expect(resultado).toMatchObject({ motivo: 'BLOCKED_ANALYSIS_ANSWERED' });
  });

  it('analise bloqueada e vazia e aceita', () => {
    const vazia = saida({
      summary: '',
      progress: [],
      positivePoints: [],
      attentionPoints: [],
      analysisBlocked: true,
    });

    expect(validarSaida(vazia, contexto({ analiseBloqueada: true })).aceita).toBe(true);
  });

  it('bloqueio no contexto exige o flag na saida', () => {
    const semFlag = saida({
      summary: '',
      progress: [],
      positivePoints: [],
      attentionPoints: [],
      analysisBlocked: false,
    });

    expect(validarSaida(semFlag, contexto({ analiseBloqueada: true }))).toMatchObject({
      motivo: 'BLOCKED_ANALYSIS_ANSWERED',
    });
  });
});

describe('numerosDoSnapshot', () => {
  it('reune medidas, metas e agregados -- e nada mais', () => {
    const numeros = numerosDoSnapshot({
      assessments: [{ measurements: [{ value: 90 }, { value: 24.1 }] }],
      goals: [{ baseline: 90, target: 85, fraction: 0.5 }],
      attendance: { totalSessions: 8, consistencyRatio: 0.75 },
    });

    expect(numeros).toContain(90);
    expect(numeros).toContain(24.1);
    expect(numeros).toContain(85);
    expect(numeros).toContain(8);
  });

  it('inclui a fracao tambem como percentual', () => {
    const numeros = numerosDoSnapshot({
      assessments: [],
      goals: [{ baseline: 90, target: 85, fraction: 0.5 }],
      attendance: { totalSessions: 0, consistencyRatio: null },
    });

    // O modelo tende a escrever "50%" onde o snapshot tem 0,5. Rejeitar isso
    // seria rejeitar prosa correta.
    expect(numeros).toContain(50);
  });
});
