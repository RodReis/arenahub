import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { TokenService } from './token.service.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG = {
  chavePrivada: privateKey,
  chavePublica: publicKey,
  emissor: 'arenahub',
  audiencia: 'arenahub-admin',
};

describe('TokenService', () => {
  const servico = new TokenService(CONFIG);

  describe('token de acesso', () => {
    const claims = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      sessionId: '33333333-3333-4333-8333-333333333333',
      permissions: ['unit.read'],
      mfa: true,
    };

    it('assina e verifica ida e volta', () => {
      const token = servico.emitirAcesso(claims);
      const verificado = servico.verificarAcesso(token);

      expect(verificado).toMatchObject({ sub: claims.sub, tenantId: claims.tenantId, mfa: true });
    });

    it('emite exatamente os claims do contrato, sem extras', () => {
      const token = servico.emitirAcesso(claims);
      const verificado = servico.verificarAcesso(token);

      // Claim a mais no access token e dado que viaja para o cliente sem
      // ninguem ter decidido que podia viajar.
      expect(Object.keys(verificado).sort()).toEqual(
        ['aud', 'exp', 'iat', 'iss', 'mfa', 'permissions', 'sessionId', 'sub', 'tenantId'].sort(),
      );
    });

    it('recusa token assinado por outra chave', () => {
      const intruso = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const outroServico = new TokenService({ ...CONFIG, chavePrivada: intruso.privateKey });

      expect(() => servico.verificarAcesso(outroServico.emitirAcesso(claims))).toThrow();
    });

    it('recusa token expirado', () => {
      const expirado = servico.emitirAcesso(claims, { validoPorSegundos: -1 });

      expect(() => servico.verificarAcesso(expirado)).toThrow();
    });

    it('recusa token com audiencia errada', () => {
      const outro = new TokenService({ ...CONFIG, audiencia: 'outra-aplicacao' });

      expect(() => servico.verificarAcesso(outro.emitirAcesso(claims))).toThrow();
    });

    it('recusa algoritmo `none`', () => {
      // O ataque classico contra JWT: trocar o alg do cabecalho por `none` e
      // apagar a assinatura. Verificador que aceita o alg do proprio token
      // entrega qualquer identidade a quem pedir.
      const cabecalho = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      const corpo = Buffer.from(JSON.stringify({ sub: 'invasor' })).toString('base64url');

      expect(() => servico.verificarAcesso(`${cabecalho}.${corpo}.`)).toThrow();
    });

    it('recusa token pre-auth como se fosse de acesso', () => {
      // O pre-auth existe so para completar o MFA. Se o guard de negocio o
      // aceitasse, exigir segundo fator viraria decoracao.
      const preAuth = servico.emitirPreAuth({
        sub: claims.sub,
        tenantId: claims.tenantId,
        challengeId: '44444444-4444-4444-8444-444444444444',
        purpose: 'MFA_VERIFY',
      });

      expect(() => servico.verificarAcesso(preAuth)).toThrow();
    });
  });

  describe('token pre-auth', () => {
    const preClaims = {
      sub: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      challengeId: '44444444-4444-4444-8444-444444444444',
      purpose: 'MFA_VERIFY' as const,
    };

    it('nao carrega permissao nenhuma', () => {
      const verificado = servico.verificarPreAuth(servico.emitirPreAuth(preClaims));

      expect(verificado).not.toHaveProperty('permissions');
      expect(verificado.purpose).toBe('MFA_VERIFY');
    });

    it('recusa token de acesso como se fosse pre-auth', () => {
      const acesso = servico.emitirAcesso({
        sub: preClaims.sub,
        tenantId: preClaims.tenantId,
        sessionId: '33333333-3333-4333-8333-333333333333',
        permissions: [],
        mfa: true,
      });

      expect(() => servico.verificarPreAuth(acesso)).toThrow();
    });
  });

  describe('refresh token', () => {
    it('gera token opaco e devolve o hash separado', () => {
      const { token, tokenHash } = servico.gerarRefresh();

      // O que vai para o cookie e opaco; o que vai para o banco e o hash.
      // Guardar o token em claro transformaria leitura de tabela em
      // sequestro de sessao.
      expect(token).toMatch(/^[\w-]{43}$/);
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(tokenHash).not.toContain(token);
    });

    it('gera valor diferente a cada chamada', () => {
      const primeiro = servico.gerarRefresh();
      const segundo = servico.gerarRefresh();

      expect(primeiro.token).not.toBe(segundo.token);
    });

    it('calcula o mesmo hash para o mesmo token', () => {
      const { token, tokenHash } = servico.gerarRefresh();

      // E assim que o refresh recebido e localizado no banco: hash do que
      // chegou, comparado com o hash gravado.
      expect(servico.calcularHashDeRefresh(token)).toBe(tokenHash);
    });
  });
});
