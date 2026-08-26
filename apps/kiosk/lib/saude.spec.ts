import { describe, expect, it } from 'vitest';

import { deltaLegivel, mesDaMedicao, rotuloDeSegmento, rotuloDeTipo, valorLegivel } from './saude';

describe('rotuloDeTipo', () => {
  it('traduz os seis tipos do §5.3', () => {
    expect(rotuloDeTipo('WEIGHT')).toBe('Peso');
    expect(rotuloDeTipo('VISCERAL_FAT_LEVEL')).toBe('Gordura visceral');
  });

  it('devolve o próprio código quando não conhece o tipo', () => {
    // Melhor um código na tela do que uma string vazia: a recepção consegue
    // dizer o que apareceu.
    expect(rotuloDeTipo('COISA_NOVA')).toBe('COISA_NOVA');
  });
});

describe('valorLegivel', () => {
  it('devolve traço para ausência, nunca zero', () => {
    // INV-104: zero e uma medicao, ausencia e a falta dela.
    expect(valorLegivel(null, 'KG')).toBe('—');
  });

  it('mostra zero medido como zero', () => {
    expect(valorLegivel(0, 'KG')).toBe('0,0 kg');
  });

  it('usa uma casa decimal', () => {
    expect(valorLegivel(82.44, 'KG')).toBe('82,4 kg');
  });

  it('cola o símbolo no percentual e separa nas demais', () => {
    expect(valorLegivel(28.4, 'PERCENT')).toBe('28,4%');
    expect(valorLegivel(38.2, 'L')).toBe('38,2 L');
  });

  it('omite unidade quando o tipo é adimensional', () => {
    // `VISCERAL_FAT_LEVEL` nao tem unidade -- e nivel, nao grandeza.
    expect(valorLegivel(7, null)).toBe('7,0');
  });
});

describe('deltaLegivel', () => {
  it('marca o aumento com sinal explícito', () => {
    // Sem o sinal, "2,4 kg" nao diz se ganhou ou perdeu -- que e a
    // informacao inteira da linha.
    expect(deltaLegivel(2.4, 'KG', null)).toBe('+2,4 kg');
  });

  it('marca a queda com sinal de menos', () => {
    expect(deltaLegivel(-2.4, 'KG', null)).toBe('−2,4 kg');
  });

  it('diz "primeira medição" em vez de zero quando não há baseline', () => {
    // Zero leria como "nao mudou", que e afirmacao diferente.
    expect(deltaLegivel(null, 'KG', 'SEM_BASELINE')).toBe('primeira medição');
  });

  it('distingue "sem mudança" de "primeira medição"', () => {
    expect(deltaLegivel(0, 'KG', null)).toBe('sem mudança');
  });

  it('devolve nulo quando não há delta e nem razão conhecida', () => {
    expect(deltaLegivel(null, 'KG', null)).toBeNull();
  });
});

describe('rotuloDeSegmento', () => {
  it('traduz as três linhas do §5.3', () => {
    expect(rotuloDeSegmento('ARMS')).toBe('Braços');
    expect(rotuloDeSegmento('TRUNK')).toBe('Tronco');
    expect(rotuloDeSegmento('LEGS')).toBe('Pernas');
  });
});

describe('mesDaMedicao', () => {
  it('devolve o mês em maiúsculas para o selo do bloco', () => {
    expect(mesDaMedicao('2026-08-03T10:00:00.000Z')).toBe('AGOSTO');
  });

  it('devolve nulo quando não há medição', () => {
    expect(mesDaMedicao(null)).toBeNull();
  });

  it('devolve nulo em vez de "Invalid Date" na tela', () => {
    expect(mesDaMedicao('nao-e-data')).toBeNull();
  });
});
