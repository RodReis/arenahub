import { dataNascimentoParaIso, mascararCpf, mascararDataNascimento } from './mascaras.js';

describe('mascararCpf', () => {
  it('formata conforme se digita, sem adiantar pontuacao', () => {
    expect(mascararCpf('1')).toBe('1');
    expect(mascararCpf('111444')).toBe('111.444');
    expect(mascararCpf('111444777')).toBe('111.444.777');
    expect(mascararCpf('11144477735')).toBe('111.444.777-35');
  });

  it('ignora o que nao e digito e corta em 11', () => {
    expect(mascararCpf('111.444.777-35extra')).toBe('111.444.777-35');
  });
});

describe('mascararDataNascimento', () => {
  it('formata DD/MM/AAAA conforme se digita', () => {
    expect(mascararDataNascimento('10')).toBe('10');
    expect(mascararDataNascimento('1005')).toBe('10/05');
    expect(mascararDataNascimento('10052000')).toBe('10/05/2000');
  });
});

describe('dataNascimentoParaIso', () => {
  it('converte DD/MM/AAAA completo para AAAA-MM-DD', () => {
    expect(dataNascimentoParaIso('10/05/2000')).toBe('2000-05-10');
  });

  it('devolve null enquanto a data nao esta completa', () => {
    expect(dataNascimentoParaIso('10/05')).toBeNull();
    expect(dataNascimentoParaIso('')).toBeNull();
  });
});
