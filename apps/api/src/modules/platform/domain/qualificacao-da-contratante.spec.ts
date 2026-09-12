import { describe, expect, it } from '@jest/globals';

import { camposFaltandoParaContrato, type DadosMinimosDeTenant } from './qualificacao-da-contratante.js';

const COMPLETO: DadosMinimosDeTenant = {
  legalName: 'Arena Positiva LTDA',
  cnpj: '12345678000199',
  addressLine: 'Av. Central, 200',
  addressCity: 'Arenápolis',
  addressState: 'MT',
  responsavelNome: 'Fulano de Tal',
  responsavelCpf: '12345678900',
};

describe('camposFaltandoParaContrato', () => {
  it('nao aponta nada faltando quando o tenant esta completo', () => {
    expect(camposFaltandoParaContrato(COMPLETO)).toEqual([]);
  });

  it('aponta CNPJ quando ausente', () => {
    expect(camposFaltandoParaContrato({ ...COMPLETO, cnpj: null })).toEqual(['CNPJ']);
  });

  it('aponta endereco quando qualquer parte dele falta', () => {
    expect(camposFaltandoParaContrato({ ...COMPLETO, addressCity: null })).toEqual(['endereço']);
  });

  it('aponta responsavel e CPF separadamente', () => {
    expect(
      camposFaltandoParaContrato({ ...COMPLETO, responsavelNome: null, responsavelCpf: null }),
    ).toEqual(['nome do responsável', 'CPF do responsável']);
  });

  /*
   * ESPACO EM BRANCO NAO E PREENCHIMENTO.
   *
   * O PATCH de tenant corta o espaco antes de validar, mas a coluna e
   * opcional, nasceu nula em producao e nada impede uma importacao ou um
   * `psql` gravar `'   '`. Sem o corte aqui, esse CNPJ passaria na checagem e
   * sairia impresso como espaco em branco no contrato -- pior que o "não
   * informado" que esta fatia veio remover, porque nao se ve.
   */
  it('trata espaco em branco como campo ausente, e nao como preenchido', () => {
    expect(
      camposFaltandoParaContrato({
        ...COMPLETO,
        cnpj: '   ',
        addressCity: '\t',
        responsavelCpf: ' ',
      }),
    ).toEqual(['CNPJ', 'endereço', 'CPF do responsável']);
  });

  it('aponta todos os campos quando o tenant nasceu sem nenhum -- caso real de producao', () => {
    expect(
      camposFaltandoParaContrato({
        legalName: 'Arena Positiva LTDA',
        cnpj: null,
        addressLine: null,
        addressCity: null,
        addressState: null,
        responsavelNome: null,
        responsavelCpf: null,
      }),
    ).toEqual(['CNPJ', 'endereço', 'nome do responsável', 'CPF do responsável']);
  });
});
