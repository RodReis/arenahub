import { describe, expect, it } from '@jest/globals';

import {
  EVENTOS_DE_CANAL,
  EventoDeTelemetriaNaoPermitidoError,
  baldeDeDuracao,
  sanitizarTelemetria,
} from './telemetria-do-canal.js';

/**
 * A telemetria e o unico dado que SAI do celular do aluno sem ele pedir.
 *
 * Por isso a regra e allowlist, nao denylist: o logger do edge-agent redige
 * campo com nome previsto (`token`, `cpf`, ...) e deixa passar o que nao
 * anteciparam. Aqui e o contrario -- o que nao esta na lista morre, e um
 * campo novo inventado pelo app nao vaza enquanto ninguem o declarar.
 */
describe('sanitizarTelemetria', () => {
  const base = {
    event: 'LOGIN_FAILED' as const,
    appVersion: '1.4.0',
    platform: 'IOS' as const,
    traceId: '0b9c1f5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b',
  };

  it('devolve apenas os campos declarados', () => {
    expect(sanitizarTelemetria({ ...base, durationBucket: 'LT_1S' })).toEqual({
      event: 'LOGIN_FAILED',
      appVersion: '1.4.0',
      platform: 'IOS',
      traceId: '0b9c1f5e-2a3d-4e5f-8a9b-0c1d2e3f4a5b',
      durationBucket: 'LT_1S',
    });
  });

  // O caso que justifica a allowlist: o app manda um campo a mais -- por bug,
  // por versao nova, por copiar objeto errado -- e ele NAO atravessa.
  it.each([
    ['e-mail', { email: 'aluno@exemplo.test' }],
    ['token de sessao', { token: 'eyJhbGciOi' }],
    ['CPF', { cpf: '39053344705' }],
    ['id de invoice', { invoiceId: 'f1e2d3c4-b5a6-4798-8a9b-0c1d2e3f4a5b' }],
    ['id do aluno', { studentId: 'a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b' }],
    ['stack de erro', { stack: 'at Object.<anonymous> (/app/src/secreto.ts:42)' }],
    ['URL visitada', { url: 'https://api.arenahub.test/mobile/invoices/123' }],
    ['payload inteiro', { payload: { cpf: '39053344705', valor: 19900 } }],
  ])('descarta %s', (_rotulo, extra) => {
    const saida = sanitizarTelemetria({ ...base, ...extra });

    expect(saida).toEqual(base);
    expect(Object.keys(saida)).not.toContain(Object.keys(extra)[0]);
  });

  // Nao basta o campo sumir da saida: o JSON inteiro nao pode conter o valor
  // em lugar nenhum -- nem aninhado, nem concatenado noutro campo.
  it('nao deixa o valor descartado sobreviver em nenhum canto do JSON', () => {
    const saida = sanitizarTelemetria({
      ...base,
      cpf: '39053344705',
      perfil: { contato: { email: 'aluno@exemplo.test' } },
    });

    const json = JSON.stringify(saida);
    expect(json).not.toContain('39053344705');
    expect(json).not.toContain('aluno@exemplo.test');
  });

  it('recusa evento fora da lista', () => {
    expect(() => sanitizarTelemetria({ ...base, event: 'EVENTO_INVENTADO' })).toThrow(
      EventoDeTelemetriaNaoPermitidoError,
    );
  });

  // Recusar, e nao normalizar em silencio: plataforma desconhecida significa
  // que o app mandou algo que este servidor nao entende, e adivinhar produz
  // metrica errada com cara de certa.
  it('recusa plataforma fora da lista', () => {
    expect(() => sanitizarTelemetria({ ...base, platform: 'WINDOWS_PHONE' })).toThrow(
      EventoDeTelemetriaNaoPermitidoError,
    );
  });

  it('recusa traceId que nao e uuid', () => {
    expect(() => sanitizarTelemetria({ ...base, traceId: 'aluno@exemplo.test' })).toThrow(
      EventoDeTelemetriaNaoPermitidoError,
    );
  });

  // `appVersion` e string livre e por isso e o buraco obvio: alguem poderia
  // mandar PII dentro dela. Formato fechado fecha o buraco.
  it('recusa appVersion fora do formato semver', () => {
    expect(() => sanitizarTelemetria({ ...base, appVersion: 'aluno@exemplo.test' })).toThrow(
      EventoDeTelemetriaNaoPermitidoError,
    );
  });

  it('aceita evento sem duracao', () => {
    expect(sanitizarTelemetria(base)).toEqual(base);
  });

  it('recusa balde de duracao fora da lista', () => {
    expect(() => sanitizarTelemetria({ ...base, durationBucket: '42ms' })).toThrow(
      EventoDeTelemetriaNaoPermitidoError,
    );
  });

  it('recusa entrada que nao e objeto', () => {
    for (const lixo of [null, undefined, 'texto', 42, []]) {
      expect(() => sanitizarTelemetria(lixo)).toThrow(EventoDeTelemetriaNaoPermitidoError);
    }
  });

  it('conhece todos os eventos declarados', () => {
    for (const evento of EVENTOS_DE_CANAL) {
      expect(sanitizarTelemetria({ ...base, event: evento }).event).toBe(evento);
    }
  });
});

/**
 * A duracao vira BALDE antes de sair do processo.
 *
 * Milissegundo exato e quase-identificador: numa coorte pequena, "login de
 * 1873 ms as 19h04" aponta para uma pessoa so. O balde responde a pergunta
 * que o piloto faz ("esta rapido?") sem responder a que ele nao deve fazer
 * ("quem e este?").
 */
describe('baldeDeDuracao', () => {
  it.each([
    [0, 'LT_1S'],
    [999, 'LT_1S'],
    [1000, '1S_3S'],
    [3000, '1S_3S'],
    [3001, 'GT_3S'],
    [120_000, 'GT_3S'],
  ])('%sms -> %s', (ms, esperado) => {
    expect(baldeDeDuracao(ms)).toBe(esperado);
  });

  it('trata duracao negativa como o balde mais rapido', () => {
    // Relogio do celular pode andar para tras entre as duas medicoes. O
    // negativo e ruido de relogio, nao evento instantaneo -- mas derrubar a
    // telemetria inteira por causa dele perderia o evento, que e o que
    // importa.
    expect(baldeDeDuracao(-5)).toBe('LT_1S');
  });
});
