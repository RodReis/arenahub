import { describe, expect, it } from 'vitest';

import { situacaoDeVencimento } from './vencimento';

describe('situacaoDeVencimento', () => {
  it('vencida quando o vencimento ja passou e a invoice segue aberta', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OPEN', dueAt: '2026-08-20T00:00:00Z', blockAt: null },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('VENCIDA');
  });

  /*
   * INVOICE PAGA NUNCA E VENCIDA, mesmo com dueAt no passado -- e o caso mais
   * comum do historico: toda fatura paga do ano passado venceu ha meses.
   */
  it('paga nunca aparece como vencida', () => {
    expect(
      situacaoDeVencimento(
        { status: 'PAID', dueAt: '2026-01-10T00:00:00Z', blockAt: null },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('EM_DIA');
  });

  /*
   * O DIA DO VENCIMENTO ainda nao venceu. Comparar instante contra instante
   * marcaria a fatura como vencida as 00:01 do proprio dia.
   */
  it('no dia do vencimento ainda nao esta vencida', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OPEN', dueAt: '2026-08-23T00:00:00Z', blockAt: null },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('VENCE_EM_BREVE');
  });

  /*
   * BLOQUEIO PROXIMO precisa do PROPRIO campo `blockAt`, nao de uma conta
   * derivada de `dueAt` -- a carencia entre vencer e bloquear varia por
   * tenant (ADR-019/INV-144), e so o backend sabe o prazo real.
   */
  it('bloqueio proximo quando blockAt cai no mesmo dia calendario de agora', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OVERDUE', dueAt: '2026-08-18T00:00:00Z', blockAt: '2026-08-23T23:59:59Z' },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('BLOQUEIO_PROXIMO');
  });

  it('vencida quando o bloqueio ainda esta longe', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OVERDUE', dueAt: '2026-08-18T00:00:00Z', blockAt: '2026-09-05T00:00:00Z' },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('VENCIDA');
  });

  /*
   * EM_DIA quando o vencimento ainda esta longe no futuro -- nao ha aviso
   * nenhum a fazer.
   */
  it('em dia quando o vencimento esta longe no futuro', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OPEN', dueAt: '2026-09-10T00:00:00Z', blockAt: null },
        new Date('2026-08-23T12:00:00Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('EM_DIA');
  });

  /*
   * FUSO IMPORTA: 21:30 em Sao_Paulo (UTC-3) e madrugada seguinte em UTC. Sem
   * o fuso da unidade, este instante cairia no dia 21 em UTC e diria "ainda
   * nao venceu" quando, na unidade, ja passou da meia-noite do vencimento.
   */
  it('usa o fuso da unidade, nao UTC, para decidir o dia', () => {
    expect(
      situacaoDeVencimento(
        { status: 'OPEN', dueAt: '2026-08-20T00:00:00Z', blockAt: null },
        new Date('2026-08-20T23:30:00-03:00'),
        'America/Sao_Paulo',
      ),
    ).toBe('VENCE_EM_BREVE');
  });
});
