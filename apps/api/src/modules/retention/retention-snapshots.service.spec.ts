import { describe, expect, it } from '@jest/globals';

import { NOMES_DE_FEATURE } from './domain/features.js';
import type { RecorteDeSnapshot } from './domain/janela-as-of.js';
import { calcularValores } from './retention-snapshots.service.js';
import type { FatosDoAluno } from './retention-snapshots.repository.js';

const OBSERVACAO = new Date('2026-08-31T00:00:00.000Z');

const RECORTE: RecorteDeSnapshot = {
  observadoEm: OBSERVACAO,
  corteDeConhecimento: OBSERVACAO,
};

function sessao(dia: string) {
  return {
    diaLocal: dia,
    ocorreuEm: new Date(`${dia}T12:00:00.000Z`),
    conhecidoEm: new Date(`${dia}T12:00:00.000Z`),
  };
}

/** Um aluno veterano e regular -- a linha de base dos testes. */
function fatosBase(): FatosDoAluno {
  return {
    sessoes: [sessao('2026-08-28'), sessao('2026-08-26'), sessao('2026-07-15')],
    invoices: [
      {
        criadaEm: new Date('2026-08-01T00:00:00.000Z'),
        venceEm: new Date('2026-09-10T00:00:00.000Z'),
        paganaEm: null,
      },
    ],
    falhasDePagamento: [],
    pausas: [],
    assinatura: {
      iniciaEm: new Date('2025-06-01T00:00:00.000Z'),
      terminaEm: null,
    },
    avaliacoesPublicadas: [
      { ocorreuEm: new Date('2026-08-01'), conhecidoEm: new Date('2026-08-01') },
    ],
    atividadeDeEngajamento: [
      { ocorreuEm: new Date('2026-08-20'), conhecidoEm: new Date('2026-08-20') },
    ],
    engajamentoSuprimido: false,
    primeiroFatoEm: new Date('2025-06-01T00:00:00.000Z'),
  };
}

function porNome(valores: ReturnType<typeof calcularValores>, nome: string) {
  const valor = valores.find((item) => item.nome === nome);

  if (valor === undefined) throw new Error(`feature ausente do calculo: ${nome}`);

  return valor;
}

describe('calcularValores', () => {
  it('produz exatamente as 13 features do PRD §9', () => {
    const valores = calcularValores(fatosBase(), RECORTE);

    expect(valores.map((item) => item.nome).sort()).toEqual([...NOMES_DE_FEATURE].sort());
  });

  it('calcula frequencia, assinatura e financeiro do aluno regular', () => {
    const valores = calcularValores(fatosBase(), RECORTE);

    expect(porNome(valores, 'attendance_days_7d').valor).toBe(2);
    expect(porNome(valores, 'attendance_days_30d').valor).toBe(2);
    expect(porNome(valores, 'attendance_days_90d').valor).toBe(3);
    expect(porNome(valores, 'past_due_invoice_count').valor).toBe(0);
    expect(porNome(valores, 'days_past_due').valor).toBe(0);
    // Plano sem termino: NAO_APLICAVEL, nunca zero.
    expect(porNome(valores, 'days_to_subscription_end').razao).toBe('NAO_APLICAVEL');
  });

  /*
   * O CASO QUE A FATIA EXISTE PARA ACERTAR.
   *
   * Aluno matriculado ha 3 dias. Toda janela longa fica AUSENTE, nunca zero --
   * senao ele aparece na fila de retencao no lugar de quem realmente sumiu.
   */
  it('marca janelas nao cobertas como ausentes para o aluno novo', () => {
    const novo: FatosDoAluno = {
      ...fatosBase(),
      sessoes: [sessao('2026-08-30')],
      primeiroFatoEm: new Date('2026-08-28T00:00:00.000Z'),
    };

    const valores = calcularValores(novo, RECORTE);

    expect(porNome(valores, 'attendance_days_30d').valor).toBeNull();
    expect(porNome(valores, 'attendance_days_30d').razao).toBe('SEM_HISTORICO');
    expect(porNome(valores, 'attendance_days_90d').razao).toBe('SEM_HISTORICO');
    expect(porNome(valores, 'pause_count_180d').razao).toBe('SEM_HISTORICO');

    // A janela de 7 dias TAMBEM nao esta coberta -- ele tem 3 dias de casa.
    expect(porNome(valores, 'attendance_days_7d').razao).toBe('SEM_HISTORICO');
  });

  it('distingue o aluno ausente do aluno novo', () => {
    // Mesmo zero treinos, significado oposto -- e e a razao que os separa.
    const ausenteHaTempo: FatosDoAluno = { ...fatosBase(), sessoes: [] };
    const valores = calcularValores(ausenteHaTempo, RECORTE);

    expect(porNome(valores, 'attendance_days_30d').valor).toBe(0);
    expect(porNome(valores, 'attendance_days_30d').razao).toBeNull();
  });

  it('suprime a feature de engajamento em vez de zera-la', () => {
    const optOut: FatosDoAluno = { ...fatosBase(), engajamentoSuprimido: true };
    const valor = porNome(calcularValores(optOut, RECORTE), 'engagement_opt_in_activity_30d');

    expect(valor.valor).toBeNull();
    expect(valor.razao).toBe('SUPRIMIDA');
  });

  it('reconhece inadimplencia pela data, nao pelo status', () => {
    const inadimplente: FatosDoAluno = {
      ...fatosBase(),
      invoices: [
        {
          criadaEm: new Date('2026-07-01T00:00:00.000Z'),
          venceEm: new Date('2026-08-10T00:00:00.000Z'),
          // Paga DEPOIS da observacao: no dia 31 ela ainda estava vencida.
          paganaEm: new Date('2026-09-05T00:00:00.000Z'),
        },
      ],
    };

    const valores = calcularValores(inadimplente, RECORTE);

    expect(porNome(valores, 'past_due_invoice_count').valor).toBe(1);
    expect(porNome(valores, 'days_past_due').valor).toBe(21);
  });

  it('marca so a feature de falha de pagamento como ESTADO_CORRENTE', () => {
    /*
     * A guarda da decisao do PI de 31/08/2026: se outra feature passar a
     * depender de campo mutavel sem que alguem perceba, este teste cai.
     */
    const valores = calcularValores(fatosBase(), RECORTE);
    const correntes = valores
      .filter((item) => item.procedencia === 'ESTADO_CORRENTE')
      .map((item) => item.nome);

    expect(correntes).toEqual(['payment_failure_count_90d']);
  });

  it('reporta assinatura indisponivel sem confundir com aluno novo', () => {
    const semAssinatura: FatosDoAluno = { ...fatosBase(), assinatura: null };
    const valores = calcularValores(semAssinatura, RECORTE);

    expect(porNome(valores, 'subscription_age_days').razao).toBe('FONTE_INDISPONIVEL');
    expect(porNome(valores, 'days_to_subscription_end').razao).toBe('FONTE_INDISPONIVEL');
  });

  it('nao devolve valor nao finito em nenhuma feature', () => {
    /*
     * `Infinity` e `NaN` atravessam JSON como `null` e contaminam agregados em
     * silencio. Varredura sobre todas as 13, para que uma divisao nova nao
     * escape.
     */
    const valores = calcularValores(fatosBase(), RECORTE);

    for (const item of valores) {
      if (item.valor !== null) expect(Number.isFinite(item.valor)).toBe(true);
    }
  });
});
