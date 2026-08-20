import { describe, expect, it } from 'vitest';

import {
  decidirCasamento,
  nascimentoEhPlausivel,
  normalizarNome,
  origemDoDireito,
  parsearDataDoPacto,
  traduzirPerfil,
  type CandidatoDeAluno,
} from './dominio.js';

describe('parsearDataDoPacto', () => {
  it('converte AAAAMMDD em data', () => {
    expect(parsearDataDoPacto('20260803')?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('converte DD/MM/AAAA em data -- o formato do nascimento', () => {
    expect(parsearDataDoPacto('11/03/1996')?.toISOString()).toBe('1996-03-11T00:00:00.000Z');
  });

  it('devolve nulo para vazio', () => {
    expect(parsearDataDoPacto('')).toBeNull();
    expect(parsearDataDoPacto('   ')).toBeNull();
  });

  it('devolve nulo para data que nao existe no calendario', () => {
    // 31 de fevereiro: `Date` normalizaria para 2 ou 3 de marco em silencio.
    expect(parsearDataDoPacto('20260231')).toBeNull();
    expect(parsearDataDoPacto('31/02/2026')).toBeNull();
  });

  it('devolve nulo para lixo', () => {
    expect(parsearDataDoPacto('1E+11')).toBeNull();
    expect(parsearDataDoPacto('abc')).toBeNull();
  });
});

describe('nascimentoEhPlausivel', () => {
  const agora = new Date('2026-08-20T12:00:00.000Z');

  it('aceita nascimento de adulto', () => {
    expect(nascimentoEhPlausivel(new Date('1996-03-11T00:00:00.000Z'), agora)).toBe(true);
  });

  it('recusa nascimento no futuro -- o arquivo traz cinco', () => {
    expect(nascimentoEhPlausivel(new Date('2026-08-01T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa bebe: ninguem de dois anos treina musculacao', () => {
    expect(nascimentoEhPlausivel(new Date('2025-09-25T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa idade impossivel', () => {
    expect(nascimentoEhPlausivel(new Date('1890-01-01T00:00:00.000Z'), agora)).toBe(false);
  });
});

describe('traduzirPerfil', () => {
  it('mapeia os quatro codigos que a academia usa', () => {
    expect(traduzirPerfil('0')).toBe('ADMIN');
    expect(traduzirPerfil('1')).toBe('STUDENT');
    expect(traduzirPerfil('2')).toBe('STAFF');
    expect(traduzirPerfil('3')).toBe('TRAINER');
  });

  it('devolve nulo para codigo de teste -- 4, 5 e 6 so aparecem em lixo', () => {
    expect(traduzirPerfil('6')).toBeNull();
    expect(traduzirPerfil('')).toBeNull();
    expect(traduzirPerfil('9')).toBeNull();
  });
});

describe('origemDoDireito', () => {
  it('aluno entra por assinatura', () => {
    expect(origemDoDireito('STUDENT')).toBe('SUBSCRIPTION');
  });

  it('professor entra como personal, nao como funcionario', () => {
    expect(origemDoDireito('TRAINER')).toBe('PERSONAL_TRAINER');
  });

  it('funcionario e administrador entram por vinculo', () => {
    expect(origemDoDireito('STAFF')).toBe('EMPLOYEE');
    expect(origemDoDireito('ADMIN')).toBe('EMPLOYEE');
  });
});

describe('normalizarNome', () => {
  it('tira acento, caixa e espaco duplicado', () => {
    expect(normalizarNome('  MARTA   Mirella  Militão ')).toBe('marta mirella militao');
  });

  it('iguala as duas grafias de Wagnusia/Wagnuzia? nao -- s e z sao letras diferentes', () => {
    expect(normalizarNome('Wagnusia')).not.toBe(normalizarNome('Wagnuzia'));
  });
});

describe('decidirCasamento', () => {
  const maria: CandidatoDeAluno = {
    id: 'id-maria',
    nomeNormalizado: 'maria silva',
    cpfNormalizado: '70310310105',
  };
  const outraMaria: CandidatoDeAluno = {
    id: 'id-maria-2',
    nomeNormalizado: 'maria silva',
    cpfNormalizado: null,
  };

  it('casa por CPF, mesmo com o nome escrito diferente', () => {
    const r = decidirCasamento({ nome: 'MARIA SILVA DE SOUZA', cpf: '703.103.101-05' }, [maria]);
    expect(r).toEqual({ tipo: 'CPF', studentId: 'id-maria' });
  });

  it('casa por nome unico quando o registro nao tem CPF', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '' }, [maria]);
    expect(r).toEqual({ tipo: 'NOME', studentId: 'id-maria' });
  });

  it('recusa quando o nome aparece duas vezes -- homonimo nao se adivinha', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '' }, [maria, outraMaria]);
    expect(r).toEqual({ tipo: 'AMBIGUO' });
  });

  it('CPF vence nome: o mesmo nome de duas pessoas nao atrapalha quem tem documento', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '70310310105' }, [maria, outraMaria]);
    expect(r).toEqual({ tipo: 'CPF', studentId: 'id-maria' });
  });

  it('recusa CPF invalido e cai para o nome', () => {
    // 111.111.111-11 passa na aritmetica e nao existe como documento.
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '11111111111' }, [maria]);
    expect(r).toEqual({ tipo: 'NOME', studentId: 'id-maria' });
  });

  it('nao encontra quando ninguem bate', () => {
    const r = decidirCasamento({ nome: 'Joao Ninguem', cpf: '' }, [maria]);
    expect(r).toEqual({ tipo: 'NAO_ENCONTRADO' });
  });

  it('recusa quando dois candidatos tem o MESMO CPF -- base duplicada', () => {
    const gemeo: CandidatoDeAluno = { ...maria, id: 'id-maria-3' };
    const r = decidirCasamento({ nome: 'Maria', cpf: '70310310105' }, [maria, gemeo]);
    expect(r).toEqual({ tipo: 'AMBIGUO' });
  });
});
