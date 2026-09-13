import { describe, expect, it } from '@jest/globals';

import {
  FUNCIONALIDADES_DE_CANAL,
  resolverFuncionalidade,
  resolverVersao,
} from './politica-de-versao.js';

const AGORA = new Date('2026-09-14T12:00:00.000Z');
const FUTURO = new Date('2026-09-20T12:00:00.000Z');
const PASSADO = new Date('2026-09-01T12:00:00.000Z');

/**
 * Quem decide a versao minima e o SERVIDOR -- `M4-NFR-007`.
 *
 * O app nunca carrega a propria minima: uma versao antiga que se auto-avalia
 * julga com a regra que tinha no dia em que foi publicada, e e exatamente a
 * versao antiga que a gente precisa bloquear.
 */
describe('resolverVersao', () => {
  it('libera versao igual ou acima da minima', () => {
    expect(resolverVersao('1.5.0', { minima: '1.5.0' }, AGORA).estado).toBe('SUPPORTED');
    expect(resolverVersao('1.6.2', { minima: '1.5.0' }, AGORA).estado).toBe('SUPPORTED');
    expect(resolverVersao('2.0.0', { minima: '1.9.9' }, AGORA).estado).toBe('SUPPORTED');
  });

  // Comparacao NUMERICA por segmento, nao lexicografica: '1.10.0' > '1.9.0'
  // e falso em ordem alfabetica, e seria o bug que libera versao velha.
  it('compara segmento a segmento como numero', () => {
    expect(resolverVersao('1.10.0', { minima: '1.9.0' }, AGORA).estado).toBe('SUPPORTED');
    expect(resolverVersao('1.9.0', { minima: '1.10.0' }, AGORA).estado).toBe('BLOCKED');
  });

  it('bloqueia versao abaixo da minima quando nao ha prazo', () => {
    const r = resolverVersao('1.4.0', { minima: '1.5.0' }, AGORA);

    expect(r.estado).toBe('BLOCKED');
    expect(r.minima).toBe('1.5.0');
  });

  it('da carencia enquanto o prazo nao venceu', () => {
    const r = resolverVersao('1.4.0', { minima: '1.5.0', carenciaAte: FUTURO }, AGORA);

    expect(r.estado).toBe('GRACE');
    expect(r.carenciaAte).toBe(FUTURO.toISOString());
  });

  it('bloqueia quando o prazo de carencia venceu', () => {
    expect(resolverVersao('1.4.0', { minima: '1.5.0', carenciaAte: PASSADO }, AGORA).estado).toBe(
      'BLOCKED',
    );
  });

  // O instante exato do vencimento ja e bloqueio: carencia "ate as 12h" que
  // ainda libera as 12h em ponto e carencia ate 12h00'01".
  it('bloqueia no instante exato do vencimento', () => {
    expect(resolverVersao('1.4.0', { minima: '1.5.0', carenciaAte: AGORA }, AGORA).estado).toBe(
      'BLOCKED',
    );
  });

  /**
   * FECHA, nao abre. Configuracao ausente ou corrompida nao pode virar
   * "libera todo mundo": e o modo de falha que transforma um erro de deploy
   * em ausencia silenciosa de controle -- e ninguem descobre, porque tudo
   * continua funcionando.
   */
  it.each([
    ['minima vazia', { minima: '' }],
    ['minima com letra', { minima: 'ultima' }],
    ['minima com segmento faltando', { minima: '1.5' }],
    ['minima nao declarada', {}],
  ])('bloqueia quando a politica esta invalida: %s', (_rotulo, politica) => {
    expect(resolverVersao('9.9.9', politica as { minima: string }, AGORA).estado).toBe('BLOCKED');
  });

  it('bloqueia quando a versao do app e ilegivel', () => {
    for (const ruim of ['', 'dev', '1.5', '1.5.x', 'null']) {
      expect(resolverVersao(ruim, { minima: '1.5.0' }, AGORA).estado).toBe('BLOCKED');
    }
  });

  // O aluno bloqueado precisa de saida: tela de atualizacao e suporte
  // continuam acessiveis, senao o bloqueio vira app morto sem explicacao.
  it('sempre devolve para onde o aluno vai atualizar', () => {
    const r = resolverVersao('1.4.0', { minima: '1.5.0', urlDeAtualizacao: 'https://a.test/app' }, AGORA);

    expect(r.urlDeAtualizacao).toBe('https://a.test/app');
  });

  it('recusa url de atualizacao que nao e https', () => {
    // `javascript:` e `http:` num campo que o app abre sao redirecao aberta.
    for (const ruim of ['javascript:alert(1)', 'http://a.test/app', 'nao-e-url']) {
      expect(
        resolverVersao('1.4.0', { minima: '1.5.0', urlDeAtualizacao: ruim }, AGORA)
          .urlDeAtualizacao,
      ).toBeNull();
    }
  });
});

/**
 * Kill switch: desligar funcionalidade SEM republicar o app.
 *
 * O caso que justifica a existencia dele: pagamento no app comeca a duplicar
 * cobranca as 22h de um sabado. Sem interruptor, a correcao passa por build,
 * revisao de loja e atualizacao do aluno -- dias. Com interruptor, segundos.
 */
describe('resolverFuncionalidade', () => {
  it('o global desligado vence o tenant ligado', () => {
    // Assimetria DELIBERADA: o global e o freio de emergencia, e freio que o
    // tenant pode soltar nao e freio.
    expect(resolverFuncionalidade({ global: false, tenant: true })).toBe(false);
  });

  it('o tenant desligado vence o global ligado', () => {
    expect(resolverFuncionalidade({ global: true, tenant: false })).toBe(false);
  });

  it('liga so quando os dois ligam', () => {
    expect(resolverFuncionalidade({ global: true, tenant: true })).toBe(true);
  });

  it('fecha quando nao ha configuracao', () => {
    expect(resolverFuncionalidade({})).toBe(false);
    expect(resolverFuncionalidade({ global: true })).toBe(false);
    expect(resolverFuncionalidade({ tenant: true })).toBe(false);
  });

  it('fecha quando o valor nao e booleano', () => {
    // `'false'` string e verdadeiro em JS -- e o defeito classico de ler flag
    // de variavel de ambiente sem converter.
    expect(resolverFuncionalidade({ global: 'true' as never, tenant: true })).toBe(false);
    expect(resolverFuncionalidade({ global: 1 as never, tenant: 1 as never })).toBe(false);
  });

  it('declara as funcionalidades que o piloto pode desligar', () => {
    expect([...FUNCIONALIDADES_DE_CANAL]).toEqual([
      'STUDENT_MOBILE',
      'MOBILE_PAYMENTS',
      'KIOSK',
      'KIOSK_PAYMENTS',
      'PUSH_NOTIFICATIONS',
    ]);
  });
});
