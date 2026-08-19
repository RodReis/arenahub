import { describe, expect, it } from '@jest/globals';

import { hashDoRecibo, type SnapshotDoRecibo } from './recibo.js';

/**
 * Codigo de verificacao do recibo. INV-075: "recibo nao fiscal, com
 * identificadores VERIFICAVEIS".
 *
 * O que estes testes protegem e a afirmacao do papel impresso: um hash que
 * mudasse com a ordem das chaves faria a conferencia falhar em recibo
 * legitimo, e a academia aprenderia a ignorar o codigo -- que e o mesmo que
 * nao te-lo.
 */

const SNAPSHOT: SnapshotDoRecibo = {
  tipo: 'RECIBO NÃO FISCAL',
  numero: 1,
  emitidoEm: '2026-08-19T12:00:00.000Z',
  tenant: { nome: 'Complexo Arena Positiva' },
  pagador: { nome: 'Fulano de Tal', matricula: 'M-001' },
  invoice: { numero: 7, competencia: '2026-08-01' },
  pagamento: {
    amountMinor: 12_000,
    currency: 'BRL',
    pagoEm: '2026-08-10T12:00:00.000Z',
    metodo: 'PIX',
    referenciaFinal: 'abc123',
  },
  itens: [{ descricao: 'Mensalidade', quantidade: 1, totalMinor: 12_000 }],
};

describe('hashDoRecibo', () => {
  it('mesmo conteudo produz o mesmo codigo', () => {
    expect(hashDoRecibo(SNAPSHOT)).toBe(hashDoRecibo({ ...SNAPSHOT }));
  });

  it('ORDEM DAS CHAVES NAO MUDA O CODIGO -- o hash e do conteudo', () => {
    // Monta o mesmo documento com as chaves em ordem invertida. Com
    // `JSON.stringify` cru, que preserva ordem de insercao, os hashes
    // divergiriam e a conferencia falharia num recibo legitimo.
    const invertido = {
      itens: SNAPSHOT.itens,
      pagamento: SNAPSHOT.pagamento,
      invoice: SNAPSHOT.invoice,
      pagador: SNAPSHOT.pagador,
      tenant: SNAPSHOT.tenant,
      emitidoEm: SNAPSHOT.emitidoEm,
      numero: SNAPSHOT.numero,
      tipo: SNAPSHOT.tipo,
    } as SnapshotDoRecibo;

    expect(hashDoRecibo(invertido)).toBe(hashDoRecibo(SNAPSHOT));
  });

  it('valor diferente muda o codigo', () => {
    const adulterado: SnapshotDoRecibo = {
      ...SNAPSHOT,
      pagamento: { ...SNAPSHOT.pagamento, amountMinor: 1_200 },
    };

    expect(hashDoRecibo(adulterado)).not.toBe(hashDoRecibo(SNAPSHOT));
  });

  it('pagador diferente muda o codigo', () => {
    const adulterado: SnapshotDoRecibo = {
      ...SNAPSHOT,
      pagador: { ...SNAPSHOT.pagador, nome: 'Outra Pessoa' },
    };

    expect(hashDoRecibo(adulterado)).not.toBe(hashDoRecibo(SNAPSHOT));
  });

  it('item a mais muda o codigo', () => {
    const adulterado: SnapshotDoRecibo = {
      ...SNAPSHOT,
      itens: [...SNAPSHOT.itens, { descricao: 'Taxa', quantidade: 1, totalMinor: 500 }],
    };

    expect(hashDoRecibo(adulterado)).not.toBe(hashDoRecibo(SNAPSHOT));
  });

  it('e um SHA-256 em hexadecimal', () => {
    expect(hashDoRecibo(SNAPSHOT)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('snapshot do recibo', () => {
  it('declara RECIBO NAO FISCAL no proprio corpo', () => {
    // Nao e detalhe de layout: o ArenaHub nao emite documento fiscal
    // (`docs/prd/README.md` §3), e um recibo que parece nota seria entregue
    // no lugar da nota que a academia ainda precisa emitir.
    expect(SNAPSHOT.tipo).toBe('RECIBO NÃO FISCAL');
  });

  it('nao expoe a referencia inteira do provedor', () => {
    // So os ultimos digitos: a referencia completa serve para consultar a API
    // do provedor, e ela vai impressa em papel que circula.
    expect(SNAPSHOT.pagamento.referenciaFinal).toHaveLength(6);
  });
});
