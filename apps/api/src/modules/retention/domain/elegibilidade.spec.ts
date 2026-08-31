import { describe, expect, it } from '@jest/globals';

import {
  RAZOES_DE_INELEGIBILIDADE,
  avaliarElegibilidade,
  type EstadoDoAluno,
} from './elegibilidade.js';

const estado = (parcial: Partial<EstadoDoAluno> = {}): EstadoDoAluno => ({
  statusDoAluno: 'ACTIVE',
  statusDaAssinatura: 'ACTIVE',
  completude: 0.8,
  supressoesVigentes: [],
  ...parcial,
});

describe('avaliarElegibilidade', () => {
  it('aprova aluno ativo com completude suficiente', () => {
    expect(avaliarElegibilidade(estado())).toEqual({ elegivel: true });
  });

  it('aprova aluno inadimplente -- e justamente quem se quer alcancar', () => {
    expect(avaliarElegibilidade(estado({ statusDaAssinatura: 'PAST_DUE' }))).toEqual({
      elegivel: true,
    });
  });

  it.each([
    ['CANCELLED' as const, 'CANCELADO'],
    ['EXPIRED' as const, 'CANCELADO'],
  ])('recusa assinatura %s -- M6-BR-003', (status, razao) => {
    expect(avaliarElegibilidade(estado({ statusDaAssinatura: status }))).toEqual({
      elegivel: false,
      razao,
    });
  });

  it('recusa aluno arquivado', () => {
    expect(avaliarElegibilidade(estado({ statusDoAluno: 'ARCHIVED' }))).toEqual({
      elegivel: false,
      razao: 'CANCELADO',
    });
  });

  it('recusa quando a completude esta abaixo do minimo', () => {
    expect(avaliarElegibilidade(estado({ completude: 0.2 }))).toEqual({
      elegivel: false,
      razao: 'HISTORICO_INSUFICIENTE',
    });
  });

  it('aceita exatamente no minimo de completude', () => {
    expect(avaliarElegibilidade(estado({ completude: 0.3 }), { completudeMinima: 0.3 })).toEqual({
      elegivel: true,
    });
  });

  it.each([
    ['OPT_OUT' as const],
    ['EXCLUSAO_PENDENTE' as const],
    ['MANUAL_COM_MOTIVO' as const],
  ])('recusa quando ha supressao vigente: %s', (motivo) => {
    expect(avaliarElegibilidade(estado({ supressoesVigentes: [motivo] }))).toEqual({
      elegivel: false,
      razao: 'SUPRIMIDO',
    });
  });

  it('poe supressao acima de completude quando as duas valem', () => {
    expect(
      avaliarElegibilidade(estado({ completude: 0.1, supressoesVigentes: ['OPT_OUT'] })),
    ).toEqual({ elegivel: false, razao: 'SUPRIMIDO' });
  });

  it('poe cancelamento acima de supressao -- a razao mais estavel vence', () => {
    expect(
      avaliarElegibilidade(
        estado({ statusDaAssinatura: 'CANCELLED', supressoesVigentes: ['OPT_OUT'] }),
      ),
    ).toEqual({ elegivel: false, razao: 'CANCELADO' });
  });

  it('tem lista fechada de razoes', () => {
    expect([...RAZOES_DE_INELEGIBILIDADE]).toEqual([
      'CANCELADO',
      'SUPRIMIDO',
      'HISTORICO_INSUFICIENTE',
    ]);
  });
});
