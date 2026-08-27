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
        xp: false,
      }),
    );

    expect(cards).toEqual([]);
  });

  it('devolve só os módulos ligados', () => {
    const cards = modulosVisiveis(comModulos({ pagamento: true, avaliacao: true }));

    expect(cards.map((c) => c.campo)).toEqual(['avaliacao', 'pagamento']);
  });

  it('devolve o card de ranking quando ligado — a F30 entregou a tela de preferência', () => {
    // Trava 2 do ADR-042, Decisao 5: modulo sem fatia entregue nao aparece.
    // Ate a F30 isso mantinha `ranking` fora da grade (a F33 nao tinha
    // entregado); a F30 entrega `<Preferencias />`, o consumidor deste
    // card, entao ele passa a aparecer como qualquer outro modulo ligado.
    const cards = modulosVisiveis(comModulos({ ranking: true }));

    expect(cards.map((c) => c.campo)).toEqual(['ranking']);
  });

  it('devolve o card de xp quando ligado, depois de ranking — a F31 entregou a tela de pontos', () => {
    const cards = modulosVisiveis(comModulos({ ranking: true, xp: true }));

    expect(cards.map((c) => c.campo)).toEqual(['ranking', 'xp']);
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
