import { describe, expect, it } from 'vitest';

import { converterRegistro, matriculaImportada, parsearDataBr, type RegistroPacto } from './parser.js';

function registroBase(): RegistroPacto {
  return {
    dados_pessoais: {
      matricula: '000881',
      nome: 'ABIGAIL DE JESUS ARRUDA',
      data_nascimento: '13/03/2000',
      telefone: '62984204010',
      email: null,
      email_truncado: false,
      sexo: 'Feminino',
      documento: '70586162135',
      documento_valido: true,
    },
    endereco: {
      logradouro: 'RUA 16 A',
      numero: '30',
      bairro: 'VILA PADRE ETERNO',
      cidade: 'TRINDADE',
      complemento: null,
      cep: '75388322',
    },
    plano: {
      nome_plano: 'PLANO PERSONAL EXCLUSIVE IND 2 OU 3X',
      situacao: 'Inativo',
    },
  };
}

describe('parsearDataBr', () => {
  it('converte dd/mm/yyyy para UTC meia-noite', () => {
    expect(parsearDataBr('13/03/2000').toISOString()).toBe('2000-03-13T00:00:00.000Z');
  });

  it('rejeita formato fora do padrao', () => {
    expect(() => parsearDataBr('2000-03-13')).toThrow(/formato/i);
  });
});

describe('matriculaImportada', () => {
  it('preenche com zeros a esquerda ate 8 digitos', () => {
    expect(matriculaImportada('881')).toBe('AP-2026-00000881');
  });

  it('mantem matricula ja com 8 digitos', () => {
    expect(matriculaImportada('00000001')).toBe('AP-2026-00000001');
  });
});

describe('converterRegistro', () => {
  it('converte registro completo', () => {
    const resultado = converterRegistro(registroBase());

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error('esperava ok');

    expect(resultado.aluno).toEqual({
      membershipNumber: 'AP-2026-00000881',
      fullName: 'ABIGAIL DE JESUS ARRUDA',
      birthDate: new Date(Date.UTC(2000, 2, 13)),
      registeredSex: 'FEMALE',
      cpf: '70586162135',
      contacts: [{ type: 'PHONE', value: '62984204010', isPrimary: true }],
      address: {
        postalCode: '75388322',
        street: 'RUA 16 A',
        number: '30',
        complement: null,
        district: 'VILA PADRE ETERNO',
        city: 'TRINDADE',
        state: 'GO',
      },
      planoOriginal: 'PLANO PERSONAL EXCLUSIVE IND 2 OU 3X',
    });
  });

  it('rejeita registro sem data de nascimento (regra 7 do ADR-033)', () => {
    const registro = registroBase();
    registro.dados_pessoais.data_nascimento = null;

    const resultado = converterRegistro(registro);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('esperava rejeicao');

    expect(resultado.rejeitado).toEqual({
      matricula: '000881',
      nome: 'ABIGAIL DE JESUS ARRUDA',
      motivo: 'SEM_DATA_NASCIMENTO',
    });
  });

  it('nao grava CPF quando documento_valido e false ou null', () => {
    const registro = registroBase();
    registro.dados_pessoais.documento = '11111111111';
    registro.dados_pessoais.documento_valido = false;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.cpf).toBeNull();
  });

  it('endereco fica null quando falta logradouro, cidade ou cep (regra 6)', () => {
    const semCidade = registroBase();
    semCidade.endereco.cidade = null;

    const resultado = converterRegistro(semCidade);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.address).toBeNull();
  });

  it('estado sempre GO, mesmo com endereco completo', () => {
    const resultado = converterRegistro(registroBase());

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.address?.state).toBe('GO');
  });

  it('email truncado nunca entra como contato (regra 9)', () => {
    const registro = registroBase();
    registro.dados_pessoais.email = 'fulano@exemplo.c';
    registro.dados_pessoais.email_truncado = true;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.contacts).toEqual([
      { type: 'PHONE', value: '62984204010', isPrimary: true },
    ]);
  });

  it('email completo entra como contato secundario quando ha telefone', () => {
    const registro = registroBase();
    registro.dados_pessoais.email = 'fulano@exemplo.com';
    registro.dados_pessoais.email_truncado = false;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.contacts).toEqual([
      { type: 'PHONE', value: '62984204010', isPrimary: true },
      { type: 'EMAIL', value: 'fulano@exemplo.com', isPrimary: false },
    ]);
  });

  it('sem telefone nem email, contatos fica vazio', () => {
    const registro = registroBase();
    registro.dados_pessoais.telefone = null;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.contacts).toEqual([]);
  });

  it('sexo nulo vira NOT_INFORMED', () => {
    const registro = registroBase();
    registro.dados_pessoais.sexo = null;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.registeredSex).toBe('NOT_INFORMED');
  });

  it('plano original preserva o texto do Pacto, mesmo nulo', () => {
    const registro = registroBase();
    registro.plano.nome_plano = null;

    const resultado = converterRegistro(registro);

    if (!resultado.ok) throw new Error('esperava ok');
    expect(resultado.aluno.planoOriginal).toBeNull();
  });
});
