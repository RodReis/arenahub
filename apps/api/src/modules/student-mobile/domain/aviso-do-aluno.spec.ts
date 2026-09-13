import { describe, expect, it } from '@jest/globals';

import { ACOES_DE_AVISO, estaVisivel, rotaDoAviso } from './aviso-do-aluno.js';

const AGORA = new Date('2026-09-14T12:00:00.000Z');

/**
 * O aviso expirado SOME da caixa -- `M4-FR-014`.
 *
 * "Sua fatura vence amanha" e informacao em janeiro e ruido em marco. Mas
 * some da TELA, nao do banco: a linha continua existindo para auditoria de
 * "o aluno foi avisado?", que e a primeira pergunta numa contestacao.
 */
describe('estaVisivel', () => {
  it('mostra aviso sem prazo', () => {
    expect(estaVisivel({ expiresAt: null }, AGORA)).toBe(true);
  });

  it('mostra aviso cujo prazo ainda nao chegou', () => {
    expect(estaVisivel({ expiresAt: new Date('2026-09-20T00:00:00.000Z') }, AGORA)).toBe(true);
  });

  it('esconde aviso vencido', () => {
    expect(estaVisivel({ expiresAt: new Date('2026-09-01T00:00:00.000Z') }, AGORA)).toBe(false);
  });

  // No instante exato ja sumiu: prazo "ate as 12h" que ainda aparece as 12h
  // em ponto e prazo ate 12h00'01".
  it('esconde no instante exato do vencimento', () => {
    expect(estaVisivel({ expiresAt: AGORA }, AGORA)).toBe(false);
  });
});

/**
 * ---------------------------------------------------------------------------
 * O AVISO NUNCA CARREGA URL. Carrega CODIGO, e o app resolve a rota.
 * ---------------------------------------------------------------------------
 *
 * A diferenca e de seguranca, nao de estilo: com URL no banco, quem
 * conseguisse escrever uma linha escolheria para onde o app do aluno navega.
 * `https://` num campo que o aplicativo abre e phishing com a marca da
 * academia em volta, e o aluno nao tem como distinguir.
 *
 * Com codigo, o pior caso de uma linha adulterada e uma navegacao para uma
 * tela legitima errada.
 */
describe('rotaDoAviso', () => {
  it('leva a fatura especifica quando ha alvo', () => {
    expect(rotaDoAviso('OPEN_INVOICE', 'a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b')).toBe(
      '/financeiro?invoice=a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b',
    );
  });

  it('leva a lista quando a acao nao tem alvo', () => {
    expect(rotaDoAviso('OPEN_INVOICE', null)).toBe('/financeiro');
    expect(rotaDoAviso('OPEN_ATTENDANCE', null)).toBe('/frequencia');
    expect(rotaDoAviso('OPEN_HEALTH', null)).toBe('/avaliacoes');
  });

  it('nao navega quando a acao e NONE', () => {
    expect(rotaDoAviso('NONE', null)).toBeNull();
    expect(rotaDoAviso('NONE', 'a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b')).toBeNull();
  });

  // A defesa central: nem alvo adulterado vira URL externa nem caminho novo.
  it.each([
    ['url absoluta', 'https://malicioso.test/roubar'],
    ['esquema javascript', 'javascript:alert(1)'],
    ['travessia de caminho', '../../admin'],
    ['barra que troca a rota', '/admin/tudo'],
    ['texto livre', 'qualquer coisa'],
    ['vazio', ''],
  ])('ignora alvo que nao e uuid: %s', (_rotulo, alvo) => {
    // Cai na lista, que e o destino seguro -- nunca no alvo recebido.
    expect(rotaDoAviso('OPEN_INVOICE', alvo)).toBe('/financeiro');
  });

  it('recusa acao desconhecida', () => {
    expect(rotaDoAviso('OPEN_ADMIN' as never, null)).toBeNull();
  });

  it('conhece todas as acoes declaradas', () => {
    for (const acao of ACOES_DE_AVISO) {
      const rota = rotaDoAviso(acao, null);
      // Toda acao ou navega para uma rota local, ou nao navega. Nunca sai.
      expect(rota === null || rota.startsWith('/')).toBe(true);
    }
  });
});
