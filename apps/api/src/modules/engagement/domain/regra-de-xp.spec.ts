import { describe, expect, it } from '@jest/globals';

import { resolverRegraVigente, type VersaoDeRegra } from './regra-de-xp.js';

const v1: VersaoDeRegra = {
  id: 'r1',
  code: 'treino-diario',
  version: 1,
  trigger: 'SESSAO_CONFIRMADA',
  points: 10,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: new Date('2026-06-01T00:00:00Z'),
};

const v2: VersaoDeRegra = {
  ...v1,
  id: 'r2',
  version: 2,
  points: 15,
  effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  effectiveTo: null,
};

describe('resolverRegraVigente', () => {
  it('escolhe a versao vigente na data do FATO, nao a mais recente', () => {
    const fatoAntigo = new Date('2026-03-10T12:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', fatoAntigo)?.id).toBe('r1');
  });

  it('escolhe a versao aberta quando o fato e posterior', () => {
    expect(
      resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', new Date('2026-08-10T12:00:00Z'))?.id,
    ).toBe('r2');
  });

  it('nao encontra regra antes da primeira vigencia', () => {
    expect(
      resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', new Date('2025-12-31T23:59:59Z')),
    ).toBeNull();
  });

  /*
   * O LIMITE INFERIOR e INCLUSIVO, e este teste e o unico que prende isso:
   * trocar `<=` por `<` na comparacao de `effectiveFrom` nao quebra nenhum
   * outro caso, porque o teste da virada e satisfeito pelo `effectiveTo`
   * exclusivo da versao anterior.
   */
  it('vale ja no primeiro instante da vigencia', () => {
    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', v1.effectiveFrom)?.id).toBe('r1');
  });

  /*
   * `effectiveTo` e EXCLUSIVO. As duas versoes se encostam em
   * 2026-06-01T00:00:00Z: se o limite fosse inclusivo, esse instante
   * pertenceria as duas, e a escolha viraria a ordem do array -- que e a
   * ordem que o banco devolveu, nao uma decisao.
   */
  it('no instante da virada, vale a versao nova', () => {
    const virada = new Date('2026-06-01T00:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', virada)?.id).toBe('r2');
  });

  it('ignora regra de outro gatilho', () => {
    const outro = { ...v2, trigger: 'OUTRO' as unknown as VersaoDeRegra['trigger'] };

    expect(
      resolverRegraVigente([outro], 'SESSAO_CONFIRMADA', new Date('2026-08-10T12:00:00Z')),
    ).toBeNull();
  });

  /*
   * A ordem de entrada nao pode decidir nada: o repositorio pode devolver
   * em qualquer ordem, e um `find` ingenuo escolheria a primeira que
   * casasse.
   */
  it('independe da ordem em que as versoes chegam', () => {
    const quando = new Date('2026-03-10T12:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', quando)?.id).toBe(
      resolverRegraVigente([v2, v1], 'SESSAO_CONFIRMADA', quando)?.id,
    );
  });
});
