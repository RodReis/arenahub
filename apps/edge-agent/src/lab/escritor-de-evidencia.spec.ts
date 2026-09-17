import { afterEach, describe, expect, it } from '@jest/globals';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { escreverEvidencia } from './escritor-de-evidencia.js';

const CAMINHO_TESTE = 'data/teste-evidencia.json';

describe('escreverEvidencia', () => {
  afterEach(() => {
    if (existsSync(CAMINHO_TESTE)) unlinkSync(CAMINHO_TESTE);
  });

  it('grava JSON com tentativas, decisoes e percentis, sem PII', () => {
    escreverEvidencia(CAMINHO_TESTE, {
      executadoEm: new Date('2026-09-16T10:00:00Z').toISOString(),
      modo: { facial: 'simulador', catraca: 'simulador' },
      tentativas: [
        { externalEnrollId: 'aluno-1', decisao: 'ALLOW', latenciaMs: 120 },
        { externalEnrollId: 'aluno-2', decisao: 'DENY', latenciaMs: 45 },
      ],
      percentis: { p50: 120, p95: 120, max: 120 },
    });

    const conteudo = JSON.parse(readFileSync(CAMINHO_TESTE, 'utf-8')) as { tentativas: unknown[] };
    expect(conteudo.tentativas).toHaveLength(2);
  });

  it('recusa gravar se algum campo parecer nome completo ou CPF', () => {
    expect(() =>
      escreverEvidencia(CAMINHO_TESTE, {
        executadoEm: new Date().toISOString(),
        modo: { facial: 'simulador', catraca: 'simulador' },
        tentativas: [{ externalEnrollId: '123.456.789-00', decisao: 'ALLOW', latenciaMs: 10 }],
        percentis: { p50: 10, p95: 10, max: 10 },
      }),
    ).toThrow(/CPF/);
  });
});
