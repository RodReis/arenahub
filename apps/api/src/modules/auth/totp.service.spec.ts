import { describe, expect, it } from '@jest/globals';

import { TotpService } from './totp.service.js';

// Vetores da RFC 6238, apendice B (segredo ASCII "12345678901234567890",
// SHA-1). Testar contra o padrao, e nao contra a propria implementacao, e o
// que garante que um autenticador de terceiro vai concordar conosco.
const SEGREDO_RFC = Buffer.from('12345678901234567890', 'ascii');
const VETORES: Array<{ instante: number; codigo: string }> = [
  { instante: 59, codigo: '287082' },
  { instante: 1111111109, codigo: '081804' },
  { instante: 1111111111, codigo: '050471' },
  { instante: 1234567890, codigo: '005924' },
  { instante: 2000000000, codigo: '279037' },
];

describe('TotpService', () => {
  const servico = new TotpService();

  describe('conformidade com a RFC 6238', () => {
    for (const vetor of VETORES) {
      it(`gera ${vetor.codigo} em t=${vetor.instante}`, () => {
        expect(servico.gerarCodigo(SEGREDO_RFC, vetor.instante)).toBe(vetor.codigo);
      });
    }
  });

  describe('verificacao', () => {
    const AGORA = 1111111109;

    it('aceita o codigo do passo atual', () => {
      const resultado = servico.verificar(SEGREDO_RFC, '081804', AGORA, null);

      expect(resultado.valido).toBe(true);
    });

    it('aceita o passo anterior e o seguinte', () => {
      // Janela de mais ou menos um passo: relogio de celular anda alguns
      // segundos fora, e sem tolerancia o usuario legitimo e recusado.
      const anterior = servico.gerarCodigo(SEGREDO_RFC, AGORA - 30);
      const seguinte = servico.gerarCodigo(SEGREDO_RFC, AGORA + 30);

      expect(servico.verificar(SEGREDO_RFC, anterior, AGORA, null).valido).toBe(true);
      expect(servico.verificar(SEGREDO_RFC, seguinte, AGORA, null).valido).toBe(true);
    });

    it('recusa dois passos atras', () => {
      const antigo = servico.gerarCodigo(SEGREDO_RFC, AGORA - 60);

      expect(servico.verificar(SEGREDO_RFC, antigo, AGORA, null).valido).toBe(false);
    });

    it('recusa codigo errado', () => {
      expect(servico.verificar(SEGREDO_RFC, '000000', AGORA, null).valido).toBe(false);
    });

    it('recusa entrada malformada sem lancar', () => {
      for (const invalido of ['', 'abcdef', '12345', '1234567']) {
        expect(servico.verificar(SEGREDO_RFC, invalido, AGORA, null).valido).toBe(false);
      }
    });

    it('recusa reuso do mesmo contador', () => {
      // O codigo vale 30 segundos. Sem o contador gravado, quem interceptar
      // o codigo tem meio minuto para reapresenta-lo -- e o segundo fator
      // deixa de ser um fator.
      const primeira = servico.verificar(SEGREDO_RFC, '081804', AGORA, null);

      expect(primeira.valido).toBe(true);

      const reuso = servico.verificar(SEGREDO_RFC, '081804', AGORA, primeira.contador);

      expect(reuso.valido).toBe(false);
      expect(reuso.motivo).toBe('REPLAY');
    });

    it('recusa contador anterior ao ultimo aceito', () => {
      // Nao basta barrar o contador igual: aceitar um anterior permitiria
      // voltar no tempo dentro da janela de tolerancia.
      const anterior = servico.gerarCodigo(SEGREDO_RFC, AGORA - 30);
      const contadorAtual = Math.floor(AGORA / 30);

      const resultado = servico.verificar(SEGREDO_RFC, anterior, AGORA, BigInt(contadorAtual));

      expect(resultado.valido).toBe(false);
    });
  });

  describe('segredo', () => {
    it('gera segredo de 20 bytes em base32', () => {
      const segredo = servico.gerarSegredo();

      expect(segredo.bytes).toHaveLength(20);
      // Base32 sem padding e o que os autenticadores leem.
      expect(segredo.base32).toMatch(/^[A-Z2-7]+$/);
    });

    it('gera segredo diferente a cada chamada', () => {
      expect(servico.gerarSegredo().base32).not.toBe(servico.gerarSegredo().base32);
    });

    it('monta URI otpauth que o autenticador entende', () => {
      const uri = servico.montarUri('ARENAHUB', 'pessoa@exemplo.test', 'JBSWY3DPEHPK3PXP');

      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });
});
