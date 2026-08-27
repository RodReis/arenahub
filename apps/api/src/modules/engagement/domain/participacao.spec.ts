import { participaDoRanking } from './participacao.js';

describe('participaDoRanking -- regime de OPT-OUT', () => {
  /*
   * O TESTE MAIS IMPORTANTE DA FATIA.
   *
   * Se alguem trocar o default para `false` (copiando a biometria, onde
   * ausencia significa NAO AUTORIZADO), este teste cai. Sem ele, a troca
   * passa verde e a academia inteira some do ranking sem ninguem notar.
   */
  it('aluno SEM linha de decisao PARTICIPA -- o oposto da biometria', () => {
    expect(participaDoRanking(null)).toBe(true);
  });

  it('aluno que pediu para sair nao participa', () => {
    expect(participaDoRanking({ decision: 'REFUSED', supersededAt: null })).toBe(false);
  });

  it('aluno que saiu e voltou participa', () => {
    expect(participaDoRanking({ decision: 'ACCEPTED', supersededAt: null })).toBe(true);
  });

  it('decisao ja substituida nao vale -- vale a linha viva', () => {
    // Uma decisao com `supersededAt` preenchido e historico, nao estado
    // atual. Tratada como ausencia: volta ao padrao, que e participar.
    expect(participaDoRanking({ decision: 'REFUSED', supersededAt: new Date() })).toBe(true);
  });
});
