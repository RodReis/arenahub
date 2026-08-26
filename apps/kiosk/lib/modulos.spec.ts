import { describe, expect, it } from 'vitest';

import { CONFIG_PADRAO_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';

import { modulosVisiveis } from './modulos';

function comModulos(modulos: Partial<KioskConfig['modulos']>): KioskConfig {
  return {
    ...CONFIG_PADRAO_DO_TOTEM,
    modulos: { ...CONFIG_PADRAO_DO_TOTEM.modulos, ...modulos },
  };
}

describe('modulosVisiveis', () => {
  it('não devolve card nenhum quando todos os módulos estão desligados', () => {
    const cards = modulosVisiveis(
      comModulos({
        pagamento: false,
        historicoDePagamentos: false,
        avaliacao: false,
        evolucao: false,
        historicoDeAvaliacoes: false,
        ranking: false,
      }),
    );

    expect(cards).toEqual([]);
  });

  it('devolve só os módulos ligados', () => {
    const cards = modulosVisiveis(comModulos({ pagamento: true, avaliacao: true }));

    expect(cards.map((c) => c.campo)).toEqual(['avaliacao', 'pagamento']);
  });

  it('não devolve card para ranking mesmo ligado — a F33 não foi entregue', () => {
    // Trava 2 do ADR-042, Decisao 5. O campo existe no contrato desde a F50;
    // o que o mantem invisivel e a ausencia na grade, e este teste e a guarda
    // contra alguem "consertar" isso acrescentando a linha antes da F33.
    const cards = modulosVisiveis(comModulos({ ranking: true }));

    expect(cards).toEqual([]);
  });

  it('mantém a ordem do DS-TOTEM §5.2, não a ordem das chaves do contrato', () => {
    const cards = modulosVisiveis(
      comModulos({
        pagamento: true,
        historicoDePagamentos: true,
        avaliacao: true,
        evolucao: true,
        historicoDeAvaliacoes: true,
      }),
    );

    expect(cards.map((c) => c.campo)).toEqual([
      'avaliacao',
      'evolucao',
      'historicoDeAvaliacoes',
      'pagamento',
      'historicoDePagamentos',
    ]);
  });

  it('marca só pagamento como transação — o resto é leitura', () => {
    const cards = modulosVisiveis(
      comModulos({ pagamento: true, historicoDePagamentos: true, avaliacao: true }),
    );

    expect(cards.filter((c) => c.natureza === 'transacao').map((c) => c.campo)).toEqual([
      'pagamento',
    ]);
  });
});
