import { describe, expect, it } from '@jest/globals';

import {
  acaoRecomendada,
  decidirRetentativa,
  ehErroPermanente,
  montarChaveDeIdempotencia,
  BACKOFF_EM_MINUTOS,
  MAXIMO_DE_TENTATIVAS,
} from './retentativa.js';

const AGORA = new Date('2026-08-16T12:00:00.000Z');

const minutosDepois = (minutos: number): Date =>
  new Date(AGORA.getTime() + minutos * 60_000);

describe('decidirRetentativa', () => {
  it('usa o backoff 1/2/3/5/8 nas quatro primeiras falhas', () => {
    expect(decidirRetentativa(1, 'DEVICE_UNREACHABLE', AGORA)).toEqual({
      estado: 'RETRYING',
      proximaTentativaEm: minutosDepois(1),
    });

    expect(decidirRetentativa(2, 'DEVICE_UNREACHABLE', AGORA)).toEqual({
      estado: 'RETRYING',
      proximaTentativaEm: minutosDepois(2),
    });

    expect(decidirRetentativa(3, 'DEVICE_UNREACHABLE', AGORA)).toEqual({
      estado: 'RETRYING',
      proximaTentativaEm: minutosDepois(3),
    });

    expect(decidirRetentativa(4, 'DEVICE_UNREACHABLE', AGORA)).toEqual({
      estado: 'RETRYING',
      proximaTentativaEm: minutosDepois(5),
    });
  });

  it('manda para a dead letter na quinta tentativa', () => {
    expect(decidirRetentativa(MAXIMO_DE_TENTATIVAS, 'DEVICE_UNREACHABLE', AGORA)).toEqual({
      estado: 'FAILED',
    });
  });

  it('nao retenta alem do maximo', () => {
    expect(decidirRetentativa(99, 'DEVICE_UNREACHABLE', AGORA)).toEqual({ estado: 'FAILED' });
  });

  it('vai direto para a dead letter em erro permanente', () => {
    // Gastar cinco tentativas repetindo o que ja se sabe que falha so atrasa
    // a descoberta pela operacao.
    expect(decidirRetentativa(1, 'DEVICE_ENROLLMENT_REJECTED', AGORA)).toEqual({
      estado: 'FAILED',
    });
  });

  it('trata erro desconhecido como transitorio', () => {
    // Desistir do que nao se conhece transformaria qualquer erro novo em
    // falha definitiva sem ninguem ter decidido isso.
    const decisao = decidirRetentativa(1, 'ERRO_QUE_NINGUEM_VIU_AINDA', AGORA);

    expect(decisao.estado).toBe('RETRYING');
  });

  it('tem uma entrada de backoff por tentativa permitida', () => {
    expect(BACKOFF_EM_MINUTOS).toHaveLength(MAXIMO_DE_TENTATIVAS);
  });
});

describe('ehErroPermanente', () => {
  it('reconhece recusa de cadastro pelo leitor', () => {
    expect(ehErroPermanente('DEVICE_ENROLLMENT_REJECTED')).toBe(true);
  });

  it('nao trata falha de rede como permanente', () => {
    expect(ehErroPermanente('DEVICE_UNREACHABLE')).toBe(false);
  });
});

describe('montarChaveDeIdempotencia', () => {
  it('e estavel para o mesmo trabalho logico', () => {
    const primeira = montarChaveDeIdempotencia('id-1', 'dev-1', 'UPSERT');
    const segunda = montarChaveDeIdempotencia('id-1', 'dev-1', 'UPSERT');

    // Outbox reprocessado nao pode virar dois jobs (regra de arquitetura 4).
    expect(primeira).toBe(segunda);
  });

  it('distingue operacao', () => {
    expect(montarChaveDeIdempotencia('id-1', 'dev-1', 'UPSERT')).not.toBe(
      montarChaveDeIdempotencia('id-1', 'dev-1', 'DELETE'),
    );
  });

  it('distingue dispositivo', () => {
    // Um job por identidade E por dispositivo (INV-024).
    expect(montarChaveDeIdempotencia('id-1', 'dev-1', 'UPSERT')).not.toBe(
      montarChaveDeIdempotencia('id-1', 'dev-2', 'UPSERT'),
    );
  });
});

describe('acaoRecomendada', () => {
  it('nao sugere acao quando nao houve erro', () => {
    expect(acaoRecomendada(null)).toBeNull();
  });

  it('traduz erro conhecido em acao concreta', () => {
    expect(acaoRecomendada('DEVICE_UNREACHABLE')).toMatch(/ligado|rede/i);
  });

  it('da uma saida para erro desconhecido', () => {
    // Codigo sozinho manda a recepcao abrir chamado para descobrir o que
    // fazer; a frase resolve na hora os casos triviais.
    expect(acaoRecomendada('ERRO_NOVO')).not.toBeNull();
  });
});
