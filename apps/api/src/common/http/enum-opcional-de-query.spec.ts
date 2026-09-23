import { describe, expect, it } from '@jest/globals';

import { enumOpcionalDeQuery } from './enum-opcional-de-query.js';

/**
 * FIX: `?outcome=&mode=` derrubava `GET /access-events` inteiro com
 * `VALIDATION_FAILED`, mesmo quando quem abriu a tela nao escolheu filtro
 * nenhum -- o combo "Todos" serializa como string vazia, nao ausencia.
 */
describe('enumOpcionalDeQuery', () => {
  const schema = enumOpcionalDeQuery(['ALLOW', 'DENY']);

  it('trata string vazia como ausente', () => {
    expect(schema.parse('')).toBeUndefined();
  });

  it('aceita valor valido', () => {
    expect(schema.parse('ALLOW')).toBe('ALLOW');
  });

  it('aceita ausencia do campo', () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  // A GUARDA CONTRA REGRESSAO SILENCIOSA: um `.catch(undefined)` teria
  // passado nos tres testes acima E neste, escondendo que a validacao real
  // sumiu -- valor invalido continua tendo de ser RECUSADO, nao virar
  // "sem filtro" por engano.
  it('recusa valor que nao esta na lista', () => {
    expect(() => schema.parse('LIXO')).toThrow();
  });
});
