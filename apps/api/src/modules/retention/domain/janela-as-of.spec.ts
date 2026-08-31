import { describe, expect, it } from '@jest/globals';

import {
  dentroDaJanela,
  diasDistintos,
  diasEntre,
  fatosDaJanela,
  type FatoDatado,
  type RecorteDeSnapshot,
} from './janela-as-of.js';

const OBSERVACAO = new Date('2026-08-31T00:00:00.000Z');

const RECORTE: RecorteDeSnapshot = {
  observadoEm: OBSERVACAO,
  corteDeConhecimento: OBSERVACAO,
};

function fato(ocorreuEm: string, conhecidoEm = ocorreuEm): FatoDatado {
  return { ocorreuEm: new Date(ocorreuEm), conhecidoEm: new Date(conhecidoEm) };
}

describe('dentroDaJanela', () => {
  it('aceita fato ocorrido e conhecido dentro da janela', () => {
    expect(dentroDaJanela(fato('2026-08-20T10:00:00.000Z'), RECORTE, 30)).toBe(true);
  });

  it('recusa fato posterior a data de observacao', () => {
    // O futuro nunca entra -- `M6-FR-003`.
    expect(dentroDaJanela(fato('2026-09-01T10:00:00.000Z'), RECORTE, 30)).toBe(false);
  });

  it('recusa fato anterior a janela', () => {
    expect(dentroDaJanela(fato('2026-06-01T10:00:00.000Z'), RECORTE, 30)).toBe(false);
  });

  /*
   * O TESTE QUE JUSTIFICA A FATIA. E o aceite literal da Slice 6.1.
   *
   * A passagem ocorreu no dia 20 (dentro da janela), mas a catraca estava
   * offline e so sincronizou no dia 31. Um snapshot do dia 25, reconstruido
   * hoje, NAO pode ve-la: no dia 25 o sistema nao sabia que ela existia.
   *
   * Sem a condicao de conhecimento este teste passa a falhar e o snapshot
   * passa a depender de QUANDO voce o calcula -- o defeito nao tem sintoma
   * visivel em producao ate o modelo da F40 errar.
   */
  it('recusa fato ocorrido na janela mas conhecido depois do corte', () => {
    const recorteDoDia25: RecorteDeSnapshot = {
      observadoEm: new Date('2026-08-25T00:00:00.000Z'),
      corteDeConhecimento: new Date('2026-08-25T00:00:00.000Z'),
    };

    const passagemSincronizadaTarde = fato('2026-08-20T07:00:00.000Z', '2026-08-31T19:00:00.000Z');

    expect(dentroDaJanela(passagemSincronizadaTarde, recorteDoDia25, 30)).toBe(false);
  });

  it('aceita o mesmo fato num snapshot posterior, quando ja era conhecido', () => {
    // Contraprova do anterior: o fato nao e proibido, so chega mais tarde.
    const passagemSincronizadaTarde = fato('2026-08-20T07:00:00.000Z', '2026-08-31T19:00:00.000Z');

    const recorteDeSetembro: RecorteDeSnapshot = {
      observadoEm: new Date('2026-09-01T00:00:00.000Z'),
      corteDeConhecimento: new Date('2026-09-01T00:00:00.000Z'),
    };

    expect(dentroDaJanela(passagemSincronizadaTarde, recorteDeSetembro, 30)).toBe(true);
  });

  it('separa corte de conhecimento da data de observacao numa reconstrucao', () => {
    /*
     * Reconstrucao auditada: observa o dia 25 usando so o que se sabia no dia
     * 25, mesmo executando hoje. E o que permite provar que o snapshot
     * original era reproduzivel.
     */
    const reconstrucao: RecorteDeSnapshot = {
      observadoEm: new Date('2026-08-25T00:00:00.000Z'),
      corteDeConhecimento: new Date('2026-08-25T00:00:00.000Z'),
    };

    expect(dentroDaJanela(fato('2026-08-24T10:00:00.000Z'), reconstrucao, 30)).toBe(true);
    expect(
      dentroDaJanela(fato('2026-08-24T10:00:00.000Z', '2026-08-26T10:00:00.000Z'), reconstrucao, 30),
    ).toBe(false);
  });

  it('trata a borda da janela como exclusiva no inicio e inclusiva no fim', () => {
    const exatamente30Dias = fato('2026-08-01T00:00:00.000Z');
    const umInstanteDepois = fato('2026-08-01T00:00:00.001Z');

    expect(dentroDaJanela(exatamente30Dias, RECORTE, 30)).toBe(false);
    expect(dentroDaJanela(umInstanteDepois, RECORTE, 30)).toBe(true);
    expect(dentroDaJanela(fato('2026-08-31T00:00:00.000Z'), RECORTE, 30)).toBe(true);
  });
});

describe('fatosDaJanela', () => {
  it('filtra preservando a ordem e descartando o conhecido tarde', () => {
    const fatos = [
      fato('2026-08-29T10:00:00.000Z'),
      fato('2026-08-15T10:00:00.000Z', '2026-09-10T10:00:00.000Z'),
      fato('2026-08-30T10:00:00.000Z'),
      fato('2026-01-01T10:00:00.000Z'),
    ];

    const resultado = fatosDaJanela(fatos, RECORTE, 30);

    expect(resultado).toEqual([fatos[0], fatos[2]]);
  });

  it('devolve lista vazia sem fatos', () => {
    expect(fatosDaJanela([], RECORTE, 30)).toEqual([]);
  });
});

describe('diasEntre', () => {
  it('trunca para baixo em vez de arredondar', () => {
    // 23h nao sao "1 dia" -- arredondar acusaria ausencia que nao houve.
    expect(diasEntre(new Date('2026-08-30T01:00:00.000Z'), OBSERVACAO)).toBe(0);
    expect(diasEntre(new Date('2026-08-30T00:00:00.000Z'), OBSERVACAO)).toBe(1);
  });

  it('conta dias cheios', () => {
    expect(diasEntre(new Date('2026-08-01T00:00:00.000Z'), OBSERVACAO)).toBe(30);
  });
});

describe('diasDistintos', () => {
  it('conta o mesmo dia uma vez so', () => {
    expect(diasDistintos(['2026-08-30', '2026-08-30', '2026-08-31'])).toBe(2);
  });

  it('devolve zero sem dias', () => {
    expect(diasDistintos([])).toBe(0);
  });
});
