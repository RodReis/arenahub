import { describe, expect, it } from 'vitest';

import {
  calcularIndicadores,
  classificar,
  classificarPa,
  idadeEm,
  reguaDe,
  type Entradas,
  type Perfil,
} from './indicadores';

const HOMEM: Perfil = { sexo: 'MALE', idade: 40 };
const MULHER: Perfil = { sexo: 'FEMALE', idade: 40 };
const ADOLESCENTE: Perfil = { sexo: 'MALE', idade: 15 };

const VAZIA: Entradas = {
  pesoKg: null,
  estaturaCm: null,
  cinturaCm: null,
  quadrilCm: null,
  gorduraPct: null,
  pas: null,
  pad: null,
  fcRepouso: null,
  vo2max: null,
};

describe('exemplos das próprias tabelas', () => {
  it('MG = 100 kg × 20% = 20 kg e MLG = 80 kg (itens 6 e 7)', () => {
    const r = calcularIndicadores({ ...VAZIA, pesoKg: 100, gorduraPct: 20 }, HOMEM);

    expect(r.massaGorda.valor).toBe(20);
    expect(r.massaMagra.valor).toBe(80);
  });

  it('PA 120/80 → PAM ≈ 93 mmHg (item 9)', () => {
    expect(calcularIndicadores({ ...VAZIA, pas: 120, pad: 80 }, HOMEM).pam.valor).toBe(93);
  });

  it('40 anos → FCmáx 180 pelas duas equações (item 11)', () => {
    const r = calcularIndicadores(VAZIA, HOMEM);

    expect(r.fcMaxTradicional).toBe(180);
    expect(r.fcMaxTanaka).toBe(180);
  });

  it('FCmáx 180 − FC repouso 60 = RFC 120, e Karvonen sobre ela (itens 12 e 13)', () => {
    const r = calcularIndicadores({ ...VAZIA, fcRepouso: 60 }, HOMEM);

    expect(r.rfc).toBe(120);
    expect(r.zonas.map((z) => [z.rotulo, z.bpmDe, z.bpmAte])).toEqual([
      ['Leve', 120, 132],
      ['Moderada', 132, 144],
      ['Moderada/alta', 144, 156],
      ['Alta', 156, 168],
      ['Muito alta/máxima', 168, 180],
    ]);
  });
});

describe('cálculos', () => {
  it('IMC, RCE e RCQ nas casas que a tela mostra', () => {
    const r = calcularIndicadores(
      { ...VAZIA, pesoKg: 80, estaturaCm: 180, cinturaCm: 90, quadrilCm: 100 },
      HOMEM,
    );

    expect(r.imc.valor).toBe(24.7);
    expect(r.rce.valor).toBe(0.5);
    expect(r.rcq.valor).toBe(0.9);
  });

  it('campo vazio não vira zero: indicador sem operando fica nulo, sem leitura', () => {
    const r = calcularIndicadores({ ...VAZIA, pesoKg: 80 }, HOMEM);

    expect(r.imc.valor).toBeNull();
    expect(r.imc.leitura).toBeNull();
    expect(r.zonas).toEqual([]);
  });

  it('Tanaka muda a RFC e as zonas', () => {
    const r = calcularIndicadores({ ...VAZIA, fcRepouso: 60 }, { sexo: 'MALE', idade: 20 }, 'TANAKA');

    expect(r.fcMaxTanaka).toBe(194);
    expect(r.rfc).toBe(134);
  });

  it('menor de 18 anos não recebe FCmáx, RFC nem zona — equação adulta proibida', () => {
    const r = calcularIndicadores({ ...VAZIA, fcRepouso: 70 }, ADOLESCENTE);

    expect(r.fcMaxTradicional).toBeNull();
    expect(r.rfc).toBeNull();
    expect(r.zonas).toEqual([]);
  });
});

describe('faixas', () => {
  it.each([
    [18.4, 'Baixo peso'],
    [18.5, 'Eutrofia'],
    [24.9, 'Eutrofia'],
    [25, 'Sobrepeso'],
    [30, 'Obesidade grau I'],
    [35, 'Obesidade grau II'],
    [40, 'Obesidade grau III'],
  ])('IMC %s → %s', (imc, classe) => {
    expect(classificar('imc', imc, HOMEM).classe).toBe(classe);
  });

  it('IMC 24,96 vira 25,0 na tela e classifica como o que a tela mostra', () => {
    const r = calcularIndicadores({ ...VAZIA, pesoKg: 80.87, estaturaCm: 180 }, HOMEM);

    expect(r.imc.valor).toBe(25);
    expect(r.imc.leitura?.classe).toBe('Sobrepeso');
  });

  it('cintura tem corte por sexo', () => {
    expect(classificar('cintura', 90, HOMEM).classe).toBe('Menor risco');
    expect(classificar('cintura', 90, MULHER).classe).toBe('Risco substancialmente aumentado');
    expect(classificar('cintura', 94, HOMEM).classe).toBe('Risco aumentado');
    expect(classificar('cintura', 102, HOMEM).classe).toBe('Risco substancialmente aumentado');
  });

  it('RCQ: 0,90 homem e 0,85 mulher', () => {
    expect(classificar('rcq', 0.89, HOMEM).classe).toBe('Menor risco');
    expect(classificar('rcq', 0.9, HOMEM).classe).toBe('Maior risco cardiometabólico');
    expect(classificar('rcq', 0.85, MULHER).classe).toBe('Maior risco cardiometabólico');
  });

  it('%GC por sexo', () => {
    expect(classificar('gordura', 10, HOMEM).classe).toBe('Atlético');
    expect(classificar('gordura', 25, HOMEM).classe).toBe('Elevado');
    expect(classificar('gordura', 25, MULHER).classe).toBe('Adequado');
    expect(classificar('gordura', 13, MULHER).classe).toBe('Muito baixo');
  });

  it('faixa por sexo sem sexo no cadastro diz isso, sem chutar', () => {
    const semSexo: Perfil = { sexo: null, idade: 30 };

    expect(classificar('cintura', 90, semSexo).tom).toBe('neutral');
    expect(classificar('gordura', 20, semSexo).classe).toMatch(/Sexo não informado/);
  });

  it.each([
    [118, 78, 'Normal'],
    [125, 78, 'Elevada'],
    [125, 85, 'Hipertensão estágio 1'],
    [135, 70, 'Hipertensão estágio 1'],
    [145, 70, 'Hipertensão estágio 2'],
    [120, 95, 'Hipertensão estágio 2'],
  ])('PA %s/%s → %s', (pas, pad, classe) => {
    expect(classificarPa(pas, pad, HOMEM).classe).toBe(classe);
  });

  it('PA ≥ 180 ou ≥ 120 é a única leitura em alerta', () => {
    expect(classificarPa(185, 100, HOMEM).alerta).toBe(true);
    expect(classificarPa(130, 125, HOMEM).alerta).toBe(true);
    expect(classificarPa(150, 95, HOMEM).alerta).toBeUndefined();
  });

  it.each([
    [45, /Bradicardia relativa/],
    [55, /Fora das faixas da tabela/],
    [70, /Faixa habitual/],
    [85, /^Elevada$/],
    [100, /Taquicardia/],
  ])('FC de repouso %s', (bpm, classe) => {
    expect(classificar('fcRepouso', bpm, HOMEM).classe).toMatch(classe);
  });

  it('menor de 18 anos nunca recebe ponto de corte adulto', () => {
    const r = calcularIndicadores(
      { ...VAZIA, pesoKg: 90, estaturaCm: 160, cinturaCm: 110, pas: 150, pad: 95, fcRepouso: 110 },
      ADOLESCENTE,
    );

    for (const leitura of [r.imc, r.cintura, r.pa, r.fcRepouso].map((i) => i.leitura)) {
      expect(leitura?.tom).toBe('neutral');
    }
  });
});

describe('régua', () => {
  it('a régua desenhada é a mesma tabela que classifica', () => {
    const regua = reguaDe('imc', HOMEM);

    expect(regua?.faixas.map((f) => f.leitura.classe)).toEqual([
      'Baixo peso',
      'Eutrofia',
      'Sobrepeso',
      'Obesidade grau I',
      'Obesidade grau II',
      'Obesidade grau III',
    ]);
  });

  it('sem régua para menor de 18 e para faixa por sexo sem sexo', () => {
    expect(reguaDe('imc', ADOLESCENTE)).toBeNull();
    expect(reguaDe('cintura', { sexo: null, idade: 30 })).toBeNull();
    expect(reguaDe('rce', { sexo: null, idade: 30 })).not.toBeNull();
  });

  it('PAM 100 ainda está dentro da referência; 101 já não', () => {
    expect(classificar('pam', 100, HOMEM).tom).toBe('success');
    expect(classificar('pam', 101, HOMEM).tom).toBe('warning');
    expect(classificar('pam', 69, HOMEM).tom).toBe('warning');
  });
});

describe('idadeEm', () => {
  it('conta anos completos na data da avaliação', () => {
    expect(idadeEm('1986-10-23', '2026-10-22')).toBe(39);
    expect(idadeEm('1986-10-22', '2026-10-22')).toBe(40);
  });

  it('data inválida devolve null', () => {
    expect(idadeEm('', '2026-10-22')).toBeNull();
  });
});
