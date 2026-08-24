import { describe, expect, it } from 'vitest';

import { diasDeAtraso, faturaEmDestaque, situacaoDeVencimento } from './vencimento';

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

describe('faturaEmDestaque', () => {
  const emAberto = (id: string, dueAt: string) => ({ id, status: 'OPEN', dueAt });

  it('sem fatura em aberto, nao ha destaque', () => {
    expect(faturaEmDestaque([{ id: 'a', status: 'PAID', dueAt: '2026-08-01' }])).toBeNull();
  });

  it('escolhe a de vencimento mais antigo', () => {
    const antiga = emAberto('b', '2026-07-10');

    expect(
      faturaEmDestaque([emAberto('a', '2026-09-10'), antiga, emAberto('c', '2026-08-10')]),
    ).toBe(antiga);
  });

  /*
   * ESCOLHE PELO CAMPO, nao pela posicao. Este e o teste que separa a funcao
   * do `lista[lista.length - 1]` que ela substituiu: com a lista embaralhada,
   * a resposta tem de ser a mesma.
   */
  it('nao depende da ordem em que a lista chega', () => {
    const faturas = [emAberto('a', '2026-09-10'), emAberto('b', '2026-07-10')];

    expect(faturaEmDestaque(faturas)?.id).toBe('b');
    expect(faturaEmDestaque([...faturas].reverse())?.id).toBe('b');
  });

  /*
   * EMPATE DE VENCIMENTO acontece de verdade: cancelar e reemitir produz duas
   * faturas com o mesmo `dueAt`. Sem desempate estavel, a tela destacaria uma
   * diferente a cada carregamento -- e o aviso da ficha apontaria para uma
   * fatura enquanto a tela de cobranca mandaria receber outra.
   */
  it('desempata por id quando o vencimento e o mesmo', () => {
    const faturas = [emAberto('z', '2026-07-10'), emAberto('a', '2026-07-10')];

    expect(faturaEmDestaque(faturas)?.id).toBe('a');
    expect(faturaEmDestaque([...faturas].reverse())?.id).toBe('a');
  });

  it('vencida entra no destaque junto com aberta', () => {
    const vencida = { id: 'v', status: 'OVERDUE', dueAt: '2026-06-01' };

    expect(faturaEmDestaque([emAberto('a', '2026-08-01'), vencida])).toBe(vencida);
  });
});

describe('diasDeAtraso', () => {
  const vencida = (dueAt: string) => ({ status: 'OVERDUE', dueAt, blockAt: null });

  /*
   * A BORDA QUE A VERSAO ANTIGA ERRAVA. `situacao-atual.tsx` subtraia
   * INSTANTES: as 00:01 do proprio dia do vencimento, a diferenca em
   * milissegundos ja era positiva e a tela anunciava "1 dia de atraso" para
   * quem tinha o dia inteiro pela frente.
   */
  it('no dia do vencimento nao ha atraso', () => {
    expect(
      diasDeAtraso(vencida('2026-08-24'), new Date('2026-08-24T03:01:00Z'), 'America/Sao_Paulo'),
    ).toBe(0);
  });

  it('conta os dias inteiros depois do vencimento', () => {
    expect(
      diasDeAtraso(vencida('2026-08-20'), new Date('2026-08-24T12:00:00Z'), 'America/Sao_Paulo'),
    ).toBe(4);
  });

  it('vencimento no futuro nao produz atraso negativo', () => {
    expect(
      diasDeAtraso(vencida('2026-09-10'), new Date('2026-08-24T12:00:00Z'), 'America/Sao_Paulo'),
    ).toBe(0);
  });

  /*
   * O FUSO DECIDE DE QUE DIA SE TRATA, e a janela entre os dois e real:
   * `03:30Z` ja e dia 25 em Sao Paulo (UTC-3, 00:30) mas ainda e dia 24 em
   * Manaus (UTC-4, 23:30). A mesma fatura, no mesmo instante, esta um dia
   * atrasada numa unidade e em dia na outra -- que e exatamente por que a
   * INV-144 proibe fuso fixo.
   */
  it('usa o fuso da unidade para saber que dia e hoje', () => {
    const instante = new Date('2026-08-25T03:30:00Z');

    expect(diasDeAtraso(vencida('2026-08-24'), instante, 'America/Sao_Paulo')).toBe(1);
    expect(diasDeAtraso(vencida('2026-08-24'), instante, 'America/Manaus')).toBe(0);
  });
});
