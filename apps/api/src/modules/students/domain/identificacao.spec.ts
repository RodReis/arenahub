import { describe, expect, it } from '@jest/globals';

import {
  calcularHashDeCpf,
  cpfEhValido,
  formatarMatricula,
  mascararCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefone,
  ultimosTresDigitosDoCpf,
} from './identificacao.js';

/**
 * CPFs sinteticos com digito verificador correto. NAO sao de pessoa real --
 * `CLAUDE.md`: nada de dado real de aluno no repositorio, nem em fixture.
 */
const CPF_VALIDO = '52998224725';
const OUTRO_CPF_VALIDO = '16899535009';

describe('normalizacao', () => {
  it('normaliza e-mail para minusculas sem espaco', () => {
    expect(normalizarEmail('  Aluno@Arena.Test ')).toBe('aluno@arena.test');
  });

  it('reduz telefone a digitos, para as duas formas baterem', () => {
    expect(normalizarTelefone('(41) 99999-0000')).toBe('41999990000');
    expect(normalizarTelefone('41999990000')).toBe('41999990000');
  });

  it('reduz CPF a digitos', () => {
    expect(normalizarCpf('529.982.247-25')).toBe(CPF_VALIDO);
  });
});

describe('cpfEhValido', () => {
  it('aceita CPF com digito verificador correto, mascarado ou nao', () => {
    expect(cpfEhValido(CPF_VALIDO)).toBe(true);
    expect(cpfEhValido('529.982.247-25')).toBe(true);
  });

  it('recusa digito verificador errado', () => {
    expect(cpfEhValido('52998224724')).toBe(false);
  });

  it('recusa tamanho diferente de 11', () => {
    expect(cpfEhValido('5299822472')).toBe(false);
    expect(cpfEhValido('529982247251')).toBe(false);
    expect(cpfEhValido('')).toBe(false);
  });

  /** Passam na aritmetica do verificador e nao existem como documento. */
  it('recusa sequencia de digito repetido', () => {
    for (let d = 0; d <= 9; d += 1) {
      expect(cpfEhValido(String(d).repeat(11))).toBe(false);
    }
  });
});

describe('calcularHashDeCpf', () => {
  it('e deterministico e ignora a mascara', () => {
    const tenant = '11111111-1111-1111-1111-111111111111';

    expect(calcularHashDeCpf(tenant, '529.982.247-25')).toBe(
      calcularHashDeCpf(tenant, CPF_VALIDO),
    );
  });

  /**
   * A pimenta por tenant e o que impede cruzar bases: vazar a tabela de uma
   * academia nao diz se o mesmo CPF existe na academia vizinha.
   */
  it('produz hash diferente para o mesmo CPF em tenants diferentes', () => {
    const a = calcularHashDeCpf('11111111-1111-1111-1111-111111111111', CPF_VALIDO);
    const b = calcularHashDeCpf('22222222-2222-2222-2222-222222222222', CPF_VALIDO);

    expect(a).not.toBe(b);
  });

  it('produz hash diferente para CPFs diferentes no mesmo tenant', () => {
    const tenant = '11111111-1111-1111-1111-111111111111';

    expect(calcularHashDeCpf(tenant, CPF_VALIDO)).not.toBe(
      calcularHashDeCpf(tenant, OUTRO_CPF_VALIDO),
    );
  });

  it('nao guarda o CPF em claro dentro do hash', () => {
    const hash = calcularHashDeCpf('11111111-1111-1111-1111-111111111111', CPF_VALIDO);

    expect(hash).not.toContain(CPF_VALIDO);
  });
});

describe('exibicao do CPF', () => {
  it('extrai os tres ultimos digitos', () => {
    expect(ultimosTresDigitosDoCpf('529.982.247-25')).toBe('725');
  });

  it('mascara mostrando so os tres ultimos, na FORMA de um CPF', () => {
    // `•` em toda posicao oculta, nunca `*` misturado com `•`: a recepcao usa
    // isto para conferir o documento na mao, e um formato que nao parece um
    // CPF a obriga a decifrar antes de comparar. O teste anterior afirmava
    // `**7-25`, que era o bug -- e o comentario da propria funcao ja descrevia
    // a forma certa.
    expect(mascararCpf('725')).toBe('•••.•••.••7-25');
  });

  it('tem o mesmo comprimento de um CPF formatado', () => {
    // 14 caracteres: `XXX.XXX.XXX-XX`. Se a mascara encolher ou crescer, ela
    // deixa de alinhar com o documento que esta sendo conferido ao lado.
    expect(mascararCpf('725')).toHaveLength('529.982.247-25'.length);
  });

  it('devolve null quando nao ha CPF', () => {
    expect(mascararCpf(null)).toBeNull();
  });
});

describe('formatarMatricula', () => {
  it('formata com 8 digitos e o ano recebido', () => {
    expect(formatarMatricula(2026, 1)).toBe('AP-2026-00000001');
    expect(formatarMatricula(2026, 42)).toBe('AP-2026-00000042');
  });

  it('nao trunca sequencial acima de 8 digitos', () => {
    expect(formatarMatricula(2026, 123456789)).toBe('AP-2026-123456789');
  });

  /**
   * INV-009 e `M1-BR-001`: a matricula nunca depende do CPF. O teste fixa
   * isso como comportamento -- a funcao nem recebe CPF para poder usa-lo.
   */
  it('nao contem nenhum trecho do CPF', () => {
    const matricula = formatarMatricula(2026, 1);

    expect(matricula).not.toContain(CPF_VALIDO.slice(0, 3));
    expect(matricula).not.toContain(CPF_VALIDO.slice(-3));
  });
});
