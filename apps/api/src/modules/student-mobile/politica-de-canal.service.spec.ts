import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { PoliticaDeCanalService } from './politica-de-canal.service.js';

const AGORA = new Date('2026-09-14T12:00:00.000Z');

/**
 * A ponte entre a regra pura e a configuracao do ambiente.
 *
 * A regra em si ja tem teste proprio (`politica-de-versao.spec.ts`); o que se
 * prova aqui e a LEITURA: que a variavel certa chega ao lugar certo, e que a
 * ausencia dela fecha em vez de abrir.
 */
describe('PoliticaDeCanalService', () => {
  const ambienteOriginal = { ...process.env };

  beforeEach(() => {
    // O servico le `process.env` a cada chamada -- de proposito: desligar o
    // pagamento num sabado a noite nao pode exigir redeploy.
    for (const chave of Object.keys(process.env)) {
      if (chave.startsWith('FEATURE_') || chave.startsWith('MOBILE_')) {
        delete process.env[chave];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ambienteOriginal };
  });

  describe('resolverVersao', () => {
    it('bloqueia quando nao ha versao minima configurada', () => {
      expect(new PoliticaDeCanalService().resolverVersao('9.9.9', AGORA).estado).toBe('BLOCKED');
    });

    it('libera a versao igual ou acima da minima', () => {
      process.env['MOBILE_MIN_VERSION'] = '1.5.0';

      expect(new PoliticaDeCanalService().resolverVersao('1.5.0', AGORA).estado).toBe('SUPPORTED');
    });

    /**
     * O header ausente BLOQUEIA -- e este e o teste que impede o buraco mais
     * obvio da politica: se cliente sem `x-app-version` fosse liberado,
     * bastaria omitir o header para escapar do bloqueio, e a politica inteira
     * viraria decoracao.
     */
    it('bloqueia cliente que nao declara a propria versao', () => {
      process.env['MOBILE_MIN_VERSION'] = '1.5.0';

      expect(new PoliticaDeCanalService().resolverVersao(undefined, AGORA).estado).toBe('BLOCKED');
    });

    it('da carencia ate o prazo configurado', () => {
      process.env['MOBILE_MIN_VERSION'] = '1.5.0';
      process.env['MOBILE_VERSION_GRACE_UNTIL'] = '2026-09-20T00:00:00.000Z';

      expect(new PoliticaDeCanalService().resolverVersao('1.4.0', AGORA).estado).toBe('GRACE');
    });

    it('leva a url de atualizacao adiante', () => {
      process.env['MOBILE_MIN_VERSION'] = '1.5.0';
      process.env['MOBILE_UPDATE_URL'] = 'https://arenahub.test/app';

      expect(new PoliticaDeCanalService().resolverVersao('1.4.0', AGORA).urlDeAtualizacao).toBe(
        'https://arenahub.test/app',
      );
    });
  });

  describe('ligada', () => {
    it('nasce desligada sem configuracao', () => {
      const politica = new PoliticaDeCanalService();

      expect(politica.ligada('STUDENT_MOBILE')).toBe(false);
      expect(politica.ligada('MOBILE_PAYMENTS')).toBe(false);
      expect(politica.ligada('PUSH_NOTIFICATIONS')).toBe(false);
    });

    it('liga com a string exata "true"', () => {
      process.env['FEATURE_STUDENT_MOBILE'] = 'true';

      expect(new PoliticaDeCanalService().ligada('STUDENT_MOBILE')).toBe(true);
    });

    /**
     * O defeito classico de flag em variavel de ambiente: toda string nao
     * vazia e verdadeira em JavaScript, e `FEATURE_KIOSK=false` LIGARIA o
     * totem com `Boolean(v)` ou `z.coerce.boolean()`.
     */
    it.each(['false', 'FALSE', '0', 'no', 'sim', ''])(
      'nao liga com o valor %p',
      (valor) => {
        process.env['FEATURE_KIOSK'] = valor;

        expect(new PoliticaDeCanalService().ligada('KIOSK')).toBe(false);
      },
    );

    it('cada funcionalidade e independente', () => {
      process.env['FEATURE_STUDENT_MOBILE'] = 'true';

      const politica = new PoliticaDeCanalService();

      // Ligar o app nao pode ligar o pagamento junto: sao interruptores
      // separados exatamente para o pagamento poder cair sozinho.
      expect(politica.ligada('STUDENT_MOBILE')).toBe(true);
      expect(politica.ligada('MOBILE_PAYMENTS')).toBe(false);
    });
  });
});
