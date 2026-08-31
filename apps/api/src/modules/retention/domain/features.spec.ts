import { describe, expect, it } from '@jest/globals';

import type { RecorteDeSnapshot } from './janela-as-of.js';
import {
  atividadeDeEngajamento,
  diasDesdeUltimaAvaliacao,
  diasDesdeUltimaPassagem,
  diasEmAtraso,
  diasParaTerminoDaAssinatura,
  diasTreinados,
  estavaVencidaEm,
  falhasDePagamento,
  idadeDaAssinatura,
  invoicesVencidas,
  NOMES_DE_FEATURE,
  pausasNaJanela,
  variacaoDeFrequencia,
  type InvoiceDatada,
  type SessaoDeTreino,
} from './features.js';

const OBSERVACAO = new Date('2026-08-31T00:00:00.000Z');

const RECORTE: RecorteDeSnapshot = {
  observadoEm: OBSERVACAO,
  corteDeConhecimento: OBSERVACAO,
};

function sessao(diaLocal: string, conhecidoEm = `${diaLocal}T12:00:00.000Z`): SessaoDeTreino {
  return {
    diaLocal,
    ocorreuEm: new Date(`${diaLocal}T12:00:00.000Z`),
    conhecidoEm: new Date(conhecidoEm),
  };
}

function invoice(
  venceEm: string,
  paganaEm: string | null = null,
  criadaEm = '2026-01-01',
): InvoiceDatada {
  return {
    criadaEm: new Date(`${criadaEm}T00:00:00.000Z`),
    venceEm: new Date(`${venceEm}T00:00:00.000Z`),
    paganaEm: paganaEm === null ? null : new Date(`${paganaEm}T00:00:00.000Z`),
  };
}

describe('catalogo de features', () => {
  it('tem exatamente as 13 do PRD §9, sem repetidas', () => {
    // Guarda contra feature nova entrar sem passar por revisao -- inclusive
    // proxy sensivel, que o PRD §9 proibe nominalmente.
    expect(NOMES_DE_FEATURE).toHaveLength(13);
    expect(new Set(NOMES_DE_FEATURE).size).toBe(13);
  });
});

describe('diasTreinados', () => {
  it('conta dias distintos dentro da janela', () => {
    const sessoes = [sessao('2026-08-30'), sessao('2026-08-30'), sessao('2026-08-29')];

    expect(diasTreinados('attendance_days_7d', sessoes, RECORTE, 7, true).valor).toBe(2);
  });

  it('devolve zero observado quando o aluno tinha janela e nao treinou', () => {
    const resultado = diasTreinados('attendance_days_30d', [], RECORTE, 30, true);

    expect(resultado.valor).toBe(0);
    expect(resultado.razao).toBeNull();
  });

  /*
   * A distincao que `M6-BR-002` exige: aluno novo NAO e aluno ausente. Sem
   * isto, quem se matriculou ontem entra na fila de retencao junto com quem
   * sumiu ha um mes.
   */
  it('devolve ausente quando a janela nao esta coberta', () => {
    const resultado = diasTreinados('attendance_days_90d', [], RECORTE, 90, false);

    expect(resultado.valor).toBeNull();
    expect(resultado.razao).toBe('SEM_HISTORICO');
  });

  it('ignora sessao conhecida depois do corte', () => {
    const sincronizadaTarde = sessao('2026-08-29', '2026-09-05T10:00:00.000Z');

    expect(diasTreinados('attendance_days_7d', [sincronizadaTarde], RECORTE, 7, true).valor).toBe(0);
  });
});

describe('variacaoDeFrequencia', () => {
  it('mede queda entre os dois periodos de 30 dias', () => {
    const sessoes = [
      sessao('2026-08-20'),
      sessao('2026-07-20'),
      sessao('2026-07-21'),
      sessao('2026-07-22'),
      sessao('2026-07-23'),
    ];

    // 1 nos ultimos 30, 4 nos 30 anteriores => (1-4)/4 = -0.75
    expect(variacaoDeFrequencia(sessoes, RECORTE, true).valor).toBeCloseTo(-0.75);
  });

  it('mede alta', () => {
    const sessoes = [sessao('2026-08-20'), sessao('2026-08-21'), sessao('2026-07-20')];

    expect(variacaoDeFrequencia(sessoes, RECORTE, true).valor).toBeCloseTo(1);
  });

  /*
   * Denominador zero e AUSENTE, nao `Infinity`. Tratar como "piorou infinito"
   * poria no topo da fila o aluno de quem nada se sabe.
   */
  it('devolve ausente quando o periodo anterior nao teve treino', () => {
    const resultado = variacaoDeFrequencia([sessao('2026-08-20')], RECORTE, true);

    expect(resultado.valor).toBeNull();
    expect(resultado.razao).toBe('SEM_HISTORICO');
    expect(Number.isFinite(resultado.valor ?? 0)).toBe(true);
  });
});

describe('diasDesdeUltimaPassagem', () => {
  it('mede a partir da passagem mais recente', () => {
    const sessoes = [sessao('2026-08-01'), sessao('2026-08-25')];

    /*
     * 5 e nao 6: a sessao e as 12h de 25/08 e a observacao e 00h de 31/08 --
     * 5 dias CHEIOS e mais meio. `diasEntre` trunca de proposito, para nao
     * acusar ausencia que ainda nao completou o dia.
     */
    expect(diasDesdeUltimaPassagem(sessoes, RECORTE).valor).toBe(5);
  });

  it('devolve ausente sem passagem na janela', () => {
    expect(diasDesdeUltimaPassagem([], RECORTE).razao).toBe('SEM_HISTORICO');
  });
});

describe('assinatura', () => {
  const assinatura = {
    iniciaEm: new Date('2026-06-01T00:00:00.000Z'),
    terminaEm: new Date('2026-09-30T00:00:00.000Z'),
  };

  it('mede idade em dias', () => {
    expect(idadeDaAssinatura(assinatura, RECORTE).valor).toBe(91);
  });

  it('mede dias ate o termino', () => {
    expect(diasParaTerminoDaAssinatura(assinatura, RECORTE).valor).toBe(30);
  });

  it('devolve negativo quando ja terminou', () => {
    const encerrada = { ...assinatura, terminaEm: new Date('2026-08-01T00:00:00.000Z') };

    expect(diasParaTerminoDaAssinatura(encerrada, RECORTE).valor).toBe(-30);
  });

  it('trata plano sem termino como nao aplicavel, nao zero', () => {
    // Zero significaria "termina hoje" -- o oposto de "nao termina".
    const semTermino = { ...assinatura, terminaEm: null };
    const resultado = diasParaTerminoDaAssinatura(semTermino, RECORTE);

    expect(resultado.valor).toBeNull();
    expect(resultado.razao).toBe('NAO_APLICAVEL');
  });
});

describe('pausasNaJanela', () => {
  it('conta pausas da timeline dentro de 180 dias', () => {
    const pausas = [
      { ocorreuEm: new Date('2026-07-01'), conhecidoEm: new Date('2026-07-01') },
      { ocorreuEm: new Date('2026-05-01'), conhecidoEm: new Date('2026-05-01') },
      { ocorreuEm: new Date('2025-01-01'), conhecidoEm: new Date('2025-01-01') },
    ];

    expect(pausasNaJanela(pausas, RECORTE, true).valor).toBe(2);
  });
});

describe('estavaVencidaEm', () => {
  it('reconhece invoice vencida e nao paga', () => {
    expect(estavaVencidaEm(invoice('2026-08-10'), OBSERVACAO)).toBe(true);
  });

  /*
   * O TESTE QUE PROVA QUE O PASSADO E PASSADO.
   *
   * A invoice venceu em 10/08 e foi paga em 28/08. Num snapshot de 20/08 ela
   * ESTAVA vencida -- ler `Invoice.status` hoje (`PAID`) a esconderia, e o
   * sinal de inadimplencia sumiria do historico inteiro.
   */
  it('reconhece invoice que estava vencida na observacao mesmo tendo sido paga depois', () => {
    const pagaDepois = invoice('2026-08-10', '2026-08-28');

    expect(estavaVencidaEm(pagaDepois, new Date('2026-08-20T00:00:00.000Z'))).toBe(true);
    expect(estavaVencidaEm(pagaDepois, OBSERVACAO)).toBe(false);
  });

  it('ignora invoice ainda nao criada na observacao', () => {
    const futura = invoice('2026-08-10', null, '2026-08-25');

    expect(estavaVencidaEm(futura, new Date('2026-08-20T00:00:00.000Z'))).toBe(false);
  });

  it('nao considera vencida no proprio dia do vencimento', () => {
    expect(estavaVencidaEm(invoice('2026-08-31'), OBSERVACAO)).toBe(false);
  });
});

describe('invoicesVencidas e diasEmAtraso', () => {
  it('conta as vencidas na data de observacao', () => {
    const invoices = [invoice('2026-08-10'), invoice('2026-07-10'), invoice('2026-09-10')];

    expect(invoicesVencidas(invoices, RECORTE).valor).toBe(2);
  });

  it('mede o atraso pela invoice vencida ha mais tempo', () => {
    // Duas de 5 dias nao sao 10 dias de atraso -- a mais antiga manda.
    const invoices = [invoice('2026-08-10'), invoice('2026-07-10')];

    expect(diasEmAtraso(invoices, RECORTE).valor).toBe(52);
  });

  it('devolve zero observado sem inadimplencia', () => {
    const resultado = diasEmAtraso([invoice('2026-09-10')], RECORTE);

    expect(resultado.valor).toBe(0);
    expect(resultado.razao).toBeNull();
  });
});

describe('falhasDePagamento', () => {
  it('conta falhas na janela e se marca como ESTADO_CORRENTE', () => {
    const falhas = [
      { ocorreuEm: new Date('2026-08-10'), conhecidoEm: new Date('2026-08-10') },
      { ocorreuEm: new Date('2026-01-10'), conhecidoEm: new Date('2026-01-10') },
    ];

    const resultado = falhasDePagamento(falhas, RECORTE, true);

    expect(resultado.valor).toBe(1);
    /*
     * A marca da decisao do PI de 31/08/2026: `PaymentAttempt.status` e
     * mutavel, entao esta feature nao e reproduzivel como as outras. Marcada,
     * a F40 a exclui do treino com um filtro em vez de refazer a fatia.
     */
    expect(resultado.procedencia).toBe('ESTADO_CORRENTE');
  });

  it('mantem a marca tambem quando ausente', () => {
    expect(falhasDePagamento([], RECORTE, false).procedencia).toBe('ESTADO_CORRENTE');
  });
});

describe('diasDesdeUltimaAvaliacao', () => {
  it('mede a partir da publicacao mais recente', () => {
    const publicacoes = [
      { ocorreuEm: new Date('2026-06-01'), conhecidoEm: new Date('2026-06-01') },
      { ocorreuEm: new Date('2026-08-01'), conhecidoEm: new Date('2026-08-01') },
    ];

    expect(diasDesdeUltimaAvaliacao(publicacoes, RECORTE).valor).toBe(30);
  });

  it('devolve ausente sem avaliacao publicada', () => {
    expect(diasDesdeUltimaAvaliacao([], RECORTE).razao).toBe('SEM_HISTORICO');
  });

  it('ignora publicacao conhecida depois do corte', () => {
    const tardia = [
      { ocorreuEm: new Date('2026-08-01'), conhecidoEm: new Date('2026-09-10') },
    ];

    expect(diasDesdeUltimaAvaliacao(tardia, RECORTE).razao).toBe('SEM_HISTORICO');
  });
});

describe('atividadeDeEngajamento', () => {
  it('conta atividade na janela de 30 dias', () => {
    const atividades = [
      { ocorreuEm: new Date('2026-08-20'), conhecidoEm: new Date('2026-08-20') },
      { ocorreuEm: new Date('2026-01-20'), conhecidoEm: new Date('2026-01-20') },
    ];

    expect(atividadeDeEngajamento(atividades, RECORTE, false).valor).toBe(1);
  });

  /*
   * `M6-FR-006`: supressao devolve SUPRIMIDA, nunca zero. Zero seria
   * "participa e nao fez nada" -- o oposto de "pediu para nao participar",
   * e usar o dado de quem saiu seria usar o que a pessoa negou.
   */
  it('devolve SUPRIMIDA em vez de zero quando ha supressao', () => {
    const atividades = [{ ocorreuEm: new Date('2026-08-20'), conhecidoEm: new Date('2026-08-20') }];
    const resultado = atividadeDeEngajamento(atividades, RECORTE, true);

    expect(resultado.valor).toBeNull();
    expect(resultado.razao).toBe('SUPRIMIDA');
  });
});
