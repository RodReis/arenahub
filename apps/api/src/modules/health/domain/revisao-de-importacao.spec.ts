import { describe, expect, it } from '@jest/globals';

import {
  ordemDeRevisao,
  pendentes,
  revisaoCompleta,
  valoresAceitos,
  type CampoExtraido,
} from './revisao-de-importacao.js';

function campo(sobrescreve: Partial<CampoExtraido> = {}): CampoExtraido {
  return {
    id: 'c1',
    type: 'WEIGHT',
    extractedValue: 90,
    extractedUnit: 'kg',
    confidence: 0.95,
    sourceLocation: 'pagina 1, linha 3',
    state: 'PENDING',
    reviewedValue: null,
    reviewedUnit: null,
    sourceLabel: null,
    ...sobrescreve,
  };
}

describe('revisaoCompleta -- INV-103, o OCR nao publica sozinho', () => {
  /**
   * Se esta funcao devolvesse `true` com campo pendente, o OCR estaria
   * publicando sozinho -- exatamente o que a regra de arquitetura no 8 e o
   * `M3-BR-006` proibem.
   */
  it('recusa enquanto houver campo pendente', () => {
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'CONFIRMED' }),
      campo({ id: 'c2', type: 'BODY_FAT_PERCENT', state: 'PENDING' }),
    ]);

    expect(r).toMatchObject({
      pronta: false,
      motivo: 'IMPORT_HAS_PENDING_FIELDS',
      campoId: 'c2',
    });
  });

  it('aceita quando todos foram revisados', () => {
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'CONFIRMED' }),
      campo({ id: 'c2', type: 'HEIGHT', state: 'DISCARDED' }),
    ]);

    expect(r).toEqual({ pronta: true });
  });

  it('um campo confirmado basta -- o resto pode ser descartado', () => {
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'CONFIRMED' }),
      campo({ id: 'c2', type: 'HEIGHT', state: 'DISCARDED' }),
      campo({ id: 'c3', type: 'BODY_FAT_PERCENT', state: 'DISCARDED' }),
    ]);

    expect(r.pronta).toBe(true);
  });

  /**
   * Importacao inteira descartada nao vira avaliacao vazia: seria um ponto no
   * grafico que nao mediu nada (INV-104).
   */
  it('recusa quando TUDO foi descartado', () => {
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'DISCARDED' }),
      campo({ id: 'c2', type: 'HEIGHT', state: 'DISCARDED' }),
    ]);

    expect(r).toMatchObject({ pronta: false, motivo: 'IMPORT_HAS_NO_USABLE_FIELD' });
  });

  it('recusa importacao sem campo nenhum', () => {
    expect(revisaoCompleta([])).toMatchObject({ motivo: 'IMPORT_HAS_NO_USABLE_FIELD' });
  });

  it('recusa campo marcado como corrigido sem valor novo', () => {
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'CORRECTED', reviewedValue: null }),
    ]);

    expect(r).toMatchObject({
      pronta: false,
      motivo: 'IMPORT_CORRECTION_WITHOUT_VALUE',
      campoId: 'c1',
    });
  });

  it('pendente e reportado ANTES de correcao incompleta', () => {
    // Ordem importa na tela: mandar o avaliador corrigir um campo enquanto
    // outro nem foi olhado inverte o fluxo de trabalho dele.
    const r = revisaoCompleta([
      campo({ id: 'c1', state: 'CORRECTED', reviewedValue: null }),
      campo({ id: 'c2', type: 'HEIGHT', state: 'PENDING' }),
    ]);

    expect(r).toMatchObject({ motivo: 'IMPORT_HAS_PENDING_FIELDS' });
  });
});

describe('valoresAceitos', () => {
  it('confirmado usa o valor do OCR', () => {
    const valores = valoresAceitos([
      campo({ state: 'CONFIRMED', extractedValue: 90, extractedUnit: 'kg' }),
    ]);

    expect(valores).toEqual([{ type: 'WEIGHT', value: 90, unit: 'kg' }]);
  });

  it('corrigido usa o valor do avaliador', () => {
    const valores = valoresAceitos([
      campo({
        state: 'CORRECTED',
        extractedValue: 3.15,
        reviewedValue: 31.5,
        extractedUnit: 'kg',
      }),
    ]);

    // O caso real: OCR leu 3,15 onde estava 31,5. O valor que vale e o do
    // humano; o do OCR continua guardado no campo (proveniencia).
    expect(valores).toEqual([{ type: 'WEIGHT', value: 31.5, unit: 'kg' }]);
  });

  it('corrigir sem informar unidade mantem a que o OCR leu', () => {
    const valores = valoresAceitos([
      campo({ state: 'CORRECTED', reviewedValue: 31.5, reviewedUnit: null, extractedUnit: 'kg' }),
    ]);

    // Quem digita "31,5" esta corrigindo o NUMERO, nao a grandeza.
    expect(valores[0]!.unit).toBe('kg');
  });

  /**
   * Descartado NAO vira zero nem `null` numa lista de medidas: o dia em que o
   * aparelho nao mediu gordura nao e o dia em que a gordura foi zero
   * (INV-104).
   */
  it('descartado simplesmente nao entra', () => {
    const valores = valoresAceitos([
      campo({ id: 'c1', state: 'CONFIRMED' }),
      campo({ id: 'c2', type: 'BODY_FAT_PERCENT', state: 'DISCARDED', extractedValue: 24 }),
    ]);

    expect(valores).toHaveLength(1);
    expect(valores[0]!.type).toBe('WEIGHT');
  });

  it('pendente nao entra -- ainda nao foi revisado', () => {
    expect(valoresAceitos([campo({ state: 'PENDING' })])).toEqual([]);
  });

  it('confirmado sem valor extraido nao entra', () => {
    // Incoerente: o avaliador confirmou o que? Deixar passar gravaria uma
    // medida sem numero e esconderia um bug do extrator.
    expect(valoresAceitos([campo({ state: 'CONFIRMED', extractedValue: null })])).toEqual([]);
  });
});

describe('ordemDeRevisao -- a confianca ordena a fila, nao decide nada', () => {
  it('menor confianca primeiro -- e onde o avaliador precisa olhar', () => {
    const ordem = ordemDeRevisao([
      campo({ id: 'alta', type: 'WEIGHT', confidence: 0.99 }),
      campo({ id: 'baixa', type: 'HEIGHT', confidence: 0.4 }),
      campo({ id: 'media', type: 'BODY_FAT_PERCENT', confidence: 0.7 }),
    ]);

    expect(ordem.map((c) => c.id)).toEqual(['baixa', 'media', 'alta']);
  });

  /**
   * `null` vai para o FIM e nao para o inicio: parser de CSV nao erra em
   * silencio -- ou le, ou falha --, e trata-lo como suspeito enterraria os
   * campos de OCR que realmente pedem atencao.
   */
  it('campo sem confianca declarada vai para o fim, nao para o inicio', () => {
    const ordem = ordemDeRevisao([
      campo({ id: 'sem', type: 'WEIGHT', confidence: null }),
      campo({ id: 'baixa', type: 'HEIGHT', confidence: 0.4 }),
    ]);

    expect(ordem.map((c) => c.id)).toEqual(['baixa', 'sem']);
  });

  it('a ordem e deterministica com confianças iguais', () => {
    const campos = [
      campo({ id: 'b', type: 'WEIGHT', confidence: 0.5 }),
      campo({ id: 'a', type: 'HEIGHT', confidence: 0.5 }),
    ];

    // Sem desempate por tipo, a ordem viria do banco e a tela mudaria entre
    // recarregamentos sem nada ter mudado.
    expect(ordemDeRevisao(campos).map((c) => c.type)).toEqual(
      ordemDeRevisao([...campos].reverse()).map((c) => c.type),
    );
  });

  it('nao muta a lista original', () => {
    const campos = [
      campo({ id: 'a', confidence: 0.9 }),
      campo({ id: 'b', type: 'HEIGHT', confidence: 0.1 }),
    ];

    ordemDeRevisao(campos);

    expect(campos.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('pendentes', () => {
  it('conta os campos que ninguem revisou', () => {
    expect(
      pendentes([
        campo({ id: 'c1', state: 'PENDING' }),
        campo({ id: 'c2', state: 'CONFIRMED' }),
        campo({ id: 'c3', state: 'PENDING' }),
      ]),
    ).toBe(2);
  });

  it('zero quando tudo foi revisado', () => {
    expect(pendentes([campo({ state: 'CONFIRMED' })])).toBe(0);
  });
});
