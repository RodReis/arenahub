import { describe, expect, it } from 'vitest';

import {
  MOTIVO_DE_AUSENCIA,
  percentualLegivel,
  rotuloDeTipo,
  rotuloDoEixo,
  simboloDeUnidade,
  valorLegivel,
  variacaoLegivel,
} from './formatar';

/**
 * F18 — o que estes testes defendem não é formatação bonita.
 *
 * `null` tem de virar traço, NUNCA `0` (INV-104, `M3-AC-004`): zero é uma
 * medição, ausência é a falta dela, e ler igual faria o gráfico e a tabela
 * mentirem sobre um dia em que ninguém pesou o aluno.
 */

describe('valorLegivel', () => {
  it('escreve valor com unidade e uma casa decimal', () => {
    expect(valorLegivel(81.25, 'KG')).toBe('81,3 kg');
  });

  it('cola o símbolo no número quando é percentual', () => {
    expect(valorLegivel(28.4, 'PERCENT')).toBe('28,4%');
  });

  it('ausência vira traço, nunca zero (INV-104)', () => {
    expect(valorLegivel(null, 'KG')).toBe('—');
  });

  it('zero medido continua sendo zero -- não é ausência', () => {
    // O caso que separa as duas coisas: um valor zero REAL tem de aparecer
    // como número, ou a tela apagaria uma medição legítima.
    expect(valorLegivel(0, 'KG')).toBe('0,0 kg');
  });

  it('tipo adimensional sai sem unidade', () => {
    // `VISCERAL_FAT_LEVEL` é índice do aparelho, não grandeza física.
    expect(valorLegivel(9, null)).toBe('9,0');
  });
});

describe('variacaoLegivel', () => {
  it('ganho leva sinal de mais explícito', () => {
    // Sem o `+`, "2,0 kg" e "-2,0 kg" viram a mesma coisa para o olho — e a
    // diferença entre ganhar e perder dois quilos é o assunto da tela.
    expect(variacaoLegivel(2, 'KG')).toBe('+2,0 kg');
  });

  it('perda leva sinal de menos', () => {
    expect(variacaoLegivel(-4.2, 'KG')).toBe('−4,2 kg');
  });

  it('sem variação escreve zero sem sinal', () => {
    expect(variacaoLegivel(0, 'KG')).toBe('0,0 kg');
  });

  it('ausência de variação vira traço, não zero', () => {
    // Aqui está a armadilha: "não mudou" e "não há com o que comparar" são
    // coisas diferentes, e ambas cairiam em "0,0 kg" se isto devolvesse zero.
    expect(variacaoLegivel(null, 'KG')).toBe('—');
  });
});

describe('percentualLegivel', () => {
  it('escreve percentual com sinal', () => {
    expect(percentualLegivel(-10)).toBe('−10,0%');
    expect(percentualLegivel(3.33)).toBe('+3,3%');
  });

  it('ausência vira traço', () => {
    // Divisão por baseline zero chega aqui como `null`; `Infinity%` na tela
    // não significa nada para quem lê.
    expect(percentualLegivel(null)).toBe('—');
  });
});

describe('MOTIVO_DE_AUSENCIA', () => {
  it('explica cada razão em vez de mostrar traço mudo', () => {
    // Cada uma pede uma ação diferente de quem lê a tela.
    expect(MOTIVO_DE_AUSENCIA['SEM_BASELINE']).toContain('anterior');
    expect(MOTIVO_DE_AUSENCIA['SEM_META']).toContain('meta');
    expect(MOTIVO_DE_AUSENCIA['BASELINE_ZERO']).toContain('zero');
  });
});

describe('rotuloDeTipo', () => {
  it('traduz os tipos medidos', () => {
    expect(rotuloDeTipo('WEIGHT')).toBe('Peso');
    expect(rotuloDeTipo('SKELETAL_MUSCLE_MASS')).toBe('Massa muscular esquelética');
  });

  it('tipo desconhecido cai no próprio código, não em branco', () => {
    // Campo vazio pareceria defeito de carregamento; o código ao menos diz o
    // que veio do servidor.
    expect(rotuloDeTipo('TIPO_NOVO')).toBe('TIPO_NOVO');
  });
});

describe('simboloDeUnidade', () => {
  it('traduz o enum do banco para o símbolo que se escreve', () => {
    expect(simboloDeUnidade('KG')).toBe('kg');
    expect(simboloDeUnidade('PERCENT')).toBe('%');
  });

  it('unidade nula sai vazia', () => {
    expect(simboloDeUnidade(null)).toBe('');
  });
});

describe('rotuloDoEixo', () => {
  it('é curto -- dia e mês bastam para situar', () => {
    // A data completa fica na tabela ao lado, com `TenantDateTime`; repetir
    // "10/06/2026" em oito pontos do eixo vira ruído.
    expect(rotuloDoEixo('2026-06-10')).toBe('10/06');
  });

  it('recorta a data pronta do servidor, sem reinterpretar fuso', () => {
    // O servidor já entregou o dia LOCAL da unidade (`assessedAtLocal`).
    // Recriar um `Date` aqui reabriria o bug que a regra 5 de lint mata: a
    // medição de ontem carimbada como hoje para quem abre a tela em outro
    // fuso.
    expect(rotuloDoEixo('2026-06-09')).toBe('09/06');
  });

  it('preserva o zero à esquerda em janeiro', () => {
    expect(rotuloDoEixo('2026-01-05')).toBe('05/01');
  });

  it('entrada fora do formato volta inteira em vez de virar lixo', () => {
    // Melhor mostrar o que veio do que "undefined/undefined" no eixo.
    expect(rotuloDoEixo('sem-data')).toBe('sem-data');
  });
});
