import { describe, expect, it } from '@jest/globals';

import { ativacaoConsultaDto, ativacaoSelfServiceDto, loginDto } from './mobile-auth.dto.js';

/** SPEC-071: login aceita CPF OU identificador (e-mail/telefone, F23), nunca os dois. */
describe('loginDto', () => {
  it('aceita CPF de 11 digitos', () => {
    const resultado = loginDto.parse({
      tenantSlug: 'arena-positiva',
      cpf: '11144477735',
      senha: 'senha-forte-123',
    });

    expect(resultado.cpf).toBe('11144477735');
  });

  it('aceita identificador (e-mail/telefone) -- retrocompatibilidade da F23', () => {
    const resultado = loginDto.parse({
      tenantSlug: 'arena-positiva',
      identificador: 'aluno@example.com',
      senha: 'senha-forte-123',
    });

    expect(resultado.identificador).toBe('aluno@example.com');
  });

  it('recusa CPF com letras ou tamanho errado', () => {
    expect(() =>
      loginDto.parse({ tenantSlug: 'arena-positiva', cpf: '123', senha: 'senha-forte-123' }),
    ).toThrow();
  });

  it('recusa os dois campos ao mesmo tempo', () => {
    expect(() =>
      loginDto.parse({
        tenantSlug: 'arena-positiva',
        cpf: '11144477735',
        identificador: 'aluno@example.com',
        senha: 'senha-forte-123',
      }),
    ).toThrow();
  });

  it('recusa nenhum dos dois', () => {
    expect(() =>
      loginDto.parse({ tenantSlug: 'arena-positiva', senha: 'senha-forte-123' }),
    ).toThrow();
  });
});

describe('ativacaoConsultaDto', () => {
  it('aceita CPF + data de nascimento, sem senha', () => {
    const resultado = ativacaoConsultaDto.parse({
      tenantSlug: 'arena-positiva',
      cpf: '11144477735',
      dataNascimento: '2000-05-10',
    });

    expect(resultado.cpf).toBe('11144477735');
    expect(resultado.dataNascimento).toBeInstanceOf(Date);
  });

  it('recusa senha no corpo -- este passo nao autentica nada', () => {
    expect(() =>
      ativacaoConsultaDto.parse({
        tenantSlug: 'arena-positiva',
        cpf: '11144477735',
        dataNascimento: '2000-05-10',
        senha: 'senha-forte-123',
      }),
    ).toThrow();
  });
});

describe('ativacaoSelfServiceDto', () => {
  it('aceita activationRef + senha + confirmacaoSenha iguais', () => {
    const resultado = ativacaoSelfServiceDto.parse({
      activationRef: 'ref-opaco',
      senha: 'senha-forte-123',
      confirmacaoSenha: 'senha-forte-123',
    });

    expect(resultado.activationRef).toBe('ref-opaco');
  });

  it('recusa senha e confirmacaoSenha diferentes', () => {
    expect(() =>
      ativacaoSelfServiceDto.parse({
        activationRef: 'ref-opaco',
        senha: 'senha-forte-123',
        confirmacaoSenha: 'outra-senha-456',
      }),
    ).toThrow();
  });

  it('nao aceita CPF nem data de nascimento -- ja foram confirmados na consulta', () => {
    expect(() =>
      ativacaoSelfServiceDto.parse({
        activationRef: 'ref-opaco',
        cpf: '11144477735',
        senha: 'senha-forte-123',
        confirmacaoSenha: 'senha-forte-123',
      }),
    ).toThrow();
  });
});
