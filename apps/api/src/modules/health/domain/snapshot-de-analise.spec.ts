import { describe, expect, it } from '@jest/globals';

import {
  conferirPseudonimizacao,
  faixaEtaria,
  montarSnapshot,
  type EntradaDoSnapshot,
} from './snapshot-de-analise.js';

const AGORA = new Date('2026-08-21T12:00:00.000Z');

function entrada(sobrescreve: Partial<EntradaDoSnapshot> = {}): EntradaDoSnapshot {
  return {
    analysisRef: 'an_7f3c2b91',
    aluno: { birthDate: new Date('1990-05-10T00:00:00.000Z'), biologicalSex: 'MALE' },
    avaliacoes: [
      {
        assessedAtLocal: '2026-01-10',
        measurements: [{ type: 'WEIGHT', value: 90, unit: 'kg' }],
      },
    ],
    metas: [],
    frequencia: { totalSessions: 8, consistencyRatio: 0.5, confirmedSource: true },
    fatores: [],
    suprimidos: [],
    analiseBloqueada: false,
    pendenciaMedicaAberta: false,
    pendenciaDesde: null,
    agora: AGORA,
    ...sobrescreve,
  };
}

describe('faixaEtaria', () => {
  it('agrupa por decada em vez de expor a idade exata', () => {
    expect(faixaEtaria(new Date('1990-05-10T00:00:00.000Z'), AGORA)).toBe('30-39');
    expect(faixaEtaria(new Date('2008-01-01T00:00:00.000Z'), AGORA)).toBe('<20');
    expect(faixaEtaria(new Date('1950-01-01T00:00:00.000Z'), AGORA)).toBe('60+');
  });

  it('respeita o aniversario que ainda nao chegou', () => {
    // Faz 30 em dezembro; em agosto ainda tem 29.
    expect(faixaEtaria(new Date('1996-12-25T00:00:00.000Z'), AGORA)).toBe('20-29');
  });

  it('sem data de nascimento cai na faixa central, e nao em null', () => {
    // A base importada do Pacto tem aluno sem nascimento; `null` obrigaria o
    // prompt a tratar ausencia.
    expect(faixaEtaria(null, AGORA)).toBe('40-49');
  });
});

describe('montarSnapshot -- o que NAO viaja (M3-NFR-009)', () => {
  /**
   * A defesa principal e a LISTA BRANCA: o snapshot e montado campo a campo,
   * sem spread. Estes testes provam o efeito dela.
   */
  it('nao carrega identificador do titular, nem sequer o studentId', () => {
    const snapshot = montarSnapshot(entrada());
    const chaves = Object.keys(snapshot);

    expect(chaves).not.toContain('studentId');
    expect(chaves).not.toContain('name');
    expect(chaves).not.toContain('cpf');
    expect(chaves).not.toContain('birthDate');
    // `studentId` seria rotulo estavel entre chamadas -- reidentificaria por
    // correlacao mesmo sem nome nenhum.
    expect(JSON.stringify(snapshot)).not.toContain('studentId');
  });

  it('a data de nascimento vira faixa, e o dia exato nao viaja', () => {
    const snapshot = montarSnapshot(entrada());

    expect(snapshot.ageRange).toBe('30-39');
    expect(JSON.stringify(snapshot)).not.toContain('1990-05-10');
  });

  /**
   * ADR-035 decisao 4: o ECG fica FORA. Vai o booleano e a data -- sem
   * traçado, sem bpm, sem o texto do achado. Com o texto, a IA vira a
   * interprete e o produto vira dispositivo medico (RDC 657/2022).
   */
  it('leva o ESTADO da pendencia medica, nunca o achado', () => {
    const snapshot = montarSnapshot(
      entrada({ pendenciaMedicaAberta: true, pendenciaDesde: '2026-08-12' }),
    );

    expect(snapshot.pendingMedicalReferral).toBe(true);
    expect(snapshot.pendingReferralSince).toBe('2026-08-12');

    const serializado = JSON.stringify(snapshot);
    expect(serializado).not.toMatch(/fibrila/i);
    expect(serializado).not.toMatch(/bpm/i);
    expect(serializado).not.toMatch(/OMRON/i);
    expect(serializado).not.toMatch(/tontura/i);
  });

  it('o tipo do snapshot nao tem onde guardar dado de ECG', () => {
    const snapshot = montarSnapshot(entrada({ pendenciaMedicaAberta: true }));

    // Estrutural, nao textual: se alguem adicionar um campo de ECG amanha,
    // este teste falha antes de o dado sair do pais.
    expect(snapshot).not.toHaveProperty('ecg');
    expect(snapshot).not.toHaveProperty('heartRate');
    expect(snapshot).not.toHaveProperty('ecgFinding');
  });
});

describe('montarSnapshot -- o que viaja, e por que', () => {
  it('leva os fatores de contexto e o que a regra ja suprimiu (ADR-037)', () => {
    const snapshot = montarSnapshot(
      entrada({
        fatores: ['SUPLEMENTACAO_CREATINA'],
        suprimidos: ['INTRACELLULAR_WATER_HIGH', 'TOTAL_BODY_WATER_HIGH'],
      }),
    );

    // Sem isto o modelo le "agua intracelular acima da faixa" e escreve o
    // ponto de atencao que o fator acabou de tirar.
    expect(snapshot.contextFactors).toEqual(['SUPLEMENTACAO_CREATINA']);
    expect(snapshot.suppressedFindings).toHaveLength(2);
  });

  it('leva se a fonte de frequencia era confirmada', () => {
    const snapshot = montarSnapshot(
      entrada({
        frequencia: { totalSessions: 0, consistencyRatio: null, confirmedSource: false },
      }),
    );

    // Sem isto o modelo escreveria "voce nao treinou neste periodo" para quem
    // treinou todos os dias com a catraca destravada.
    expect(snapshot.attendance.confirmedSource).toBe(false);
  });

  it('mantem a ordem cronologica das avaliacoes', () => {
    const snapshot = montarSnapshot(
      entrada({
        avaliacoes: [
          { assessedAtLocal: '2026-01-10', measurements: [] },
          { assessedAtLocal: '2026-06-10', measurements: [] },
        ],
      }),
    );

    expect(snapshot.assessments.map((a) => a.assessedAtLocal)).toEqual([
      '2026-01-10',
      '2026-06-10',
    ]);
  });
});

describe('conferirPseudonimizacao -- a rede de seguranca', () => {
  it('deixa passar snapshot limpo', () => {
    expect(() => conferirPseudonimizacao(montarSnapshot(entrada()))).not.toThrow();
  });

  /**
   * A lista branca protege contra campo novo no TIPO. Nao protege contra
   * alguem enfiando PII dentro de um campo ja permitido -- e por isso que
   * esta segunda barreira existe.
   */
  /**
   * A PII e plantada num campo de CONTEUDO (a unidade de uma medida), e nao
   * na `analysisRef`: a referencia opaca esta fora da varredura de proposito
   * -- ela e hex aleatorio nosso, e o padrao de telefone casava com ~8% dos
   * sorteios, recusando uma analise legitima a cada doze.
   */
  function comUnidadeSuja(texto: string) {
    return {
      ...montarSnapshot(entrada()),
      assessments: [
        {
          assessedAtLocal: '2026-01-10',
          measurements: [{ type: 'WEIGHT' as const, value: 90, unit: texto }],
        },
      ],
    };
  }

  it('recusa CPF escondido num campo permitido', () => {
    expect(() => conferirPseudonimizacao(comUnidadeSuja('kg 123.456.789-00'))).toThrow(
      /padrao proibido/,
    );
  });

  it('recusa e-mail e telefone', () => {
    expect(() => conferirPseudonimizacao(comUnidadeSuja('aluno@exemplo.com'))).toThrow(
      /padrao proibido/,
    );
    expect(() => conferirPseudonimizacao(comUnidadeSuja('(41) 99999-8888'))).toThrow(
      /padrao proibido/,
    );
  });

  /**
   * A referencia opaca e hex de 32 caracteres. Sem a exclusao, este teste
   * falharia em ~8% das execucoes -- o defeito que a suite de integracao
   * desta fatia encontrou.
   */
  it('nao confunde a referencia opaca com telefone', () => {
    const comRefNumerica = {
      ...montarSnapshot(entrada()),
      analysisRef: 'an_41999998888aaaabbbbccccddddeeee',
    };

    expect(() => conferirPseudonimizacao(comRefNumerica)).not.toThrow();
  });

  it('a mensagem de erro NAO inclui o dado pessoal que casou', () => {
    const sujo = comUnidadeSuja('kg 123.456.789-00');

    try {
      conferirPseudonimizacao(sujo);
      throw new Error('deveria ter lancado');
    } catch (erro) {
      // `CLAUDE.md`: nunca logar PII em erro. A mensagem diria o CPF inteiro
      // se incluisse o trecho casado -- e erro vai para o log.
      expect((erro as Error).message).not.toContain('123.456.789-00');
    }
  });
});
