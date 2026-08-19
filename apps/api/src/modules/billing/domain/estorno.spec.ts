import { describe, expect, it } from '@jest/globals';

import {
  EstornoInvalidoError,
  LimiteDeEstornoExcedidoError,
  PagamentoManualNaoEstornavelError,
  estornoEhTotal,
  podeTransicionarEstorno,
  suspendeAcessoAgora,
  validarPedidoDeEstorno,
  type PagamentoParaEstorno,
  type PedidoDeEstorno,
} from './estorno.js';
import { ValorMonetarioInvalidoError } from './dinheiro.js';

/**
 * Regras do estorno. F16, `M2-FR-017`, `M2-BR-009`, INV-069, INV-094.
 *
 * `CONVENTION.md` §2.3 marca `Refund` como `[indefinido]`; o que este arquivo
 * prova sao as regras decididas na fatia, e as duas que vieram do PI em
 * 19/08/2026 (`M2-COMPLIANCE-01`): `KEEP_UNTIL_PERIOD_END` e teto por tenant.
 */

const PAGAMENTO_PIX: PagamentoParaEstorno = {
  status: 'CONFIRMED',
  method: 'PIX',
  amountMinor: 12_000,
  currency: 'BRL',
};

const PEDIDO: PedidoDeEstorno = {
  amountMinor: 12_000,
  reason: 'aluno desistiu no primeiro dia',
  limiteMinor: null,
  jaEstornadoMinor: 0,
};

describe('validarPedidoDeEstorno', () => {
  it('aceita estorno total de pagamento PIX confirmado', () => {
    expect(() => validarPedidoDeEstorno(PAGAMENTO_PIX, PEDIDO)).not.toThrow();
  });

  it('aceita estorno parcial', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 4_000 }),
    ).not.toThrow();
  });

  it('recusa pagamento manual -- devolucao acontece fora do sistema (ADR-027)', () => {
    expect(() =>
      validarPedidoDeEstorno({ ...PAGAMENTO_PIX, method: 'MANUAL' }, PEDIDO),
    ).toThrow(PagamentoManualNaoEstornavelError);
  });

  it('recusa pagamento manual ANTES de olhar o valor', () => {
    // A ordem das guardas e o que se prova aqui: um estorno manual acima do
    // teto tem de reclamar do METODO, nao do valor -- senao a operadora vai
    // procurar alcada maior para uma operacao que nao existe.
    expect(() =>
      validarPedidoDeEstorno(
        { ...PAGAMENTO_PIX, method: 'MANUAL' },
        { ...PEDIDO, limiteMinor: 100 },
      ),
    ).toThrow(PagamentoManualNaoEstornavelError);
  });

  it.each(['PENDING', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'])(
    'recusa estorno de pagamento em %s',
    (status) => {
      expect(() => validarPedidoDeEstorno({ ...PAGAMENTO_PIX, status }, PEDIDO)).toThrow(
        EstornoInvalidoError,
      );
    },
  );

  it('recusa valor zero', () => {
    expect(() => validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 0 })).toThrow(
      EstornoInvalidoError,
    );
  });

  it('recusa valor negativo -- barrado antes, pela guarda monetaria comum', () => {
    // Erro DIFERENTE de proposito: negativo em coluna de dinheiro e violacao
    // de INV-065, nao regra de estorno. Quem barra e `validarValorMonetario`,
    // que ja serve invoice e pagamento -- duplicar a checagem aqui criaria
    // duas mensagens para o mesmo defeito.
    expect(() => validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: -1 })).toThrow(
      ValorMonetarioInvalidoError,
    );
  });

  it('recusa valor acima do pagamento original', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 12_001 }),
    ).toThrow(EstornoInvalidoError);
  });

  it('DOIS PARCIAIS NAO SOMAM MAIS QUE O TOTAL -- cada um valido sozinho', () => {
    // O bug que este teste existe para impedir: 60% + 60% = 120% devolvidos.
    // Sem descontar `jaEstornadoMinor`, os dois passariam isoladamente.
    const segundoParcial = { ...PEDIDO, amountMinor: 7_200, jaEstornadoMinor: 7_200 };
    expect(() => validarPedidoDeEstorno(PAGAMENTO_PIX, segundoParcial)).toThrow(
      EstornoInvalidoError,
    );
  });

  it('aceita o parcial que cabe exatamente no que sobrou', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 4_800, jaEstornadoMinor: 7_200 }),
    ).not.toThrow();
  });

  it('recusa acima do teto do tenant, com codigo proprio', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 12_000, limiteMinor: 5_000 }),
    ).toThrow(LimiteDeEstornoExcedidoError);
  });

  it('teto nulo nao limita nada', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, limiteMinor: null }),
    ).not.toThrow();
  });

  it('teto exatamente igual ao pedido passa -- o limite e inclusivo', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, limiteMinor: 12_000 }),
    ).not.toThrow();
  });

  it('exige razao (INV-072, INV-126)', () => {
    expect(() => validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, reason: '  ' })).toThrow(
      EstornoInvalidoError,
    );
  });

  it('recusa valor nao inteiro -- centavos, nunca float (INV-065)', () => {
    expect(() =>
      validarPedidoDeEstorno(PAGAMENTO_PIX, { ...PEDIDO, amountMinor: 120.5 }),
    ).toThrow();
  });
});

describe('estornoEhTotal', () => {
  it('parcial sozinho nao zera o pagamento', () => {
    expect(estornoEhTotal(12_000, 0, 4_000)).toBe(false);
  });

  it('soma dos parciais fecha o total', () => {
    expect(estornoEhTotal(12_000, 7_200, 4_800)).toBe(true);
  });

  it('estorno total de uma vez fecha', () => {
    expect(estornoEhTotal(12_000, 0, 12_000)).toBe(true);
  });
});

describe('podeTransicionarEstorno', () => {
  it('REQUESTED caminha para PROCESSING, CONFIRMED ou FAILED', () => {
    expect(podeTransicionarEstorno('REQUESTED', 'PROCESSING')).toBe(true);
    expect(podeTransicionarEstorno('REQUESTED', 'CONFIRMED')).toBe(true);
    expect(podeTransicionarEstorno('REQUESTED', 'FAILED')).toBe(true);
  });

  it('CONFIRMED e FAILED sao terminais -- reentrega atrasada nao reescreve (INV-079)', () => {
    expect(podeTransicionarEstorno('CONFIRMED', 'FAILED')).toBe(false);
    expect(podeTransicionarEstorno('FAILED', 'CONFIRMED')).toBe(false);
    expect(podeTransicionarEstorno('CONFIRMED', 'PROCESSING')).toBe(false);
  });

  it('nao volta de PROCESSING para REQUESTED', () => {
    expect(podeTransicionarEstorno('PROCESSING', 'REQUESTED')).toBe(false);
  });
});

describe('suspendeAcessoAgora', () => {
  it('KEEP_UNTIL_PERIOD_END nao suspende -- decisao do PI em 19/08/2026', () => {
    expect(suspendeAcessoAgora('KEEP_UNTIL_PERIOD_END')).toBe(false);
  });

  it('SUSPEND_ON_CONFIRMATION suspende', () => {
    expect(suspendeAcessoAgora('SUSPEND_ON_CONFIRMATION')).toBe(true);
  });
});
