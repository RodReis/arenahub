import { faltaParaCartao } from './dados-de-cobranca.js';

describe('faltaParaCartao', () => {
  it('nao falta nada quando o aluno tem CPF e endereco', () => {
    expect(faltaParaCartao({ cpf: '12345678901', temEndereco: true })).toEqual([]);
  });

  it('acusa o CPF ausente', () => {
    expect(faltaParaCartao({ cpf: null, temEndereco: true })).toEqual(['CPF']);
  });

  it('acusa o endereco ausente', () => {
    expect(faltaParaCartao({ cpf: '12345678901', temEndereco: false })).toEqual(['ENDERECO']);
  });

  /*
   * OS DOIS DE UMA VEZ, em ordem estavel. A tela lista o que falta numa
   * frase; ordem instavel faria a mesma pendencia aparecer de dois jeitos
   * entre dois carregamentos.
   */
  it('acusa os dois, sempre na mesma ordem', () => {
    expect(faltaParaCartao({ cpf: null, temEndereco: false })).toEqual(['CPF', 'ENDERECO']);
  });

  /*
   * CPF EM BRANCO nao e CPF. A coluna e anulavel e a base do Pacto tem 308
   * alunos sem ele (ADR-034); string vazia vinda de importacao antiga
   * passaria por `!== null` e chegaria ao antifraude como campo vazio.
   */
  it('trata CPF em branco como ausente', () => {
    expect(faltaParaCartao({ cpf: '   ', temEndereco: true })).toEqual(['CPF']);
  });
});
