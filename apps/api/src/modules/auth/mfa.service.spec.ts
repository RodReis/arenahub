import { randomBytes } from 'node:crypto';

import { describe, expect, it, beforeEach } from '@jest/globals';

import { CifradorDeSegredo } from './segredo-cifrado.js';
import { MfaService } from './mfa.service.js';
import { TotpService } from './totp.service.js';

const CHAVE = randomBytes(32);
const USER_ID = 'user-1';
const EMAIL = 'admin@arenahub.test';

/**
 * Dublê de banco com um registro só. Guarda o que `update` grava para que a
 * chamada seguinte a `iniciarInscricao` leia o mesmo estado que a API leria.
 */
function criarBanco() {
  const registro: {
    mfaStatus: string;
    mfaSecretCiphertext: Uint8Array | null;
    mfaSecretIv: Uint8Array | null;
    mfaSecretTag: Uint8Array | null;
    mfaLastCounter: bigint | null;
  } = {
    mfaStatus: 'DISABLED',
    mfaSecretCiphertext: null,
    mfaSecretIv: null,
    mfaSecretTag: null,
    mfaLastCounter: null,
  };

  return {
    registro,
    user: {
      findUniqueOrThrow: () => Promise.resolve(registro),
      findUnique: () => Promise.resolve(registro),
      update: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(registro, data);
        return Promise.resolve(registro);
      },
    },
  };
}

describe('MfaService.iniciarInscricao', () => {
  let banco: ReturnType<typeof criarBanco>;
  let servico: MfaService;

  beforeEach(() => {
    banco = criarBanco();
    servico = new MfaService(
      banco as never,
      new TotpService(),
      new CifradorDeSegredo(CHAVE),
    );
  });

  it('grava segredo PENDING na primeira chamada', async () => {
    const inscricao = await servico.iniciarInscricao(USER_ID, EMAIL);

    expect(banco.registro.mfaStatus).toBe('PENDING');
    expect(banco.registro.mfaSecretCiphertext).not.toBeNull();
    expect(inscricao.base32).toMatch(/^[A-Z2-7]+$/);
  });

  it('devolve a MESMA chave quando ja existe inscricao PENDING', async () => {
    // A tela chama esta rota de novo a cada reload. Gerar segredo novo aqui
    // troca a chave debaixo de quem ja cadastrou a anterior no autenticador,
    // e o codigo dele nunca mais bate -- o app tem uma chave, o banco tem outra.
    const primeira = await servico.iniciarInscricao(USER_ID, EMAIL);
    const segunda = await servico.iniciarInscricao(USER_ID, EMAIL);

    expect(segunda.base32).toBe(primeira.base32);
    expect(segunda.uri).toBe(primeira.uri);
  });

  it('nao regrava o segredo cifrado quando reaproveita o PENDING', async () => {
    await servico.iniciarInscricao(USER_ID, EMAIL);
    const ciphertextOriginal = Buffer.from(banco.registro.mfaSecretCiphertext!);

    await servico.iniciarInscricao(USER_ID, EMAIL);

    expect(Buffer.from(banco.registro.mfaSecretCiphertext!).equals(ciphertextOriginal)).toBe(true);
  });

  it('gera segredo novo quando o anterior ja foi ativado', async () => {
    // ENABLED nao e inscricao pendente: recadastrar precisa de segredo novo,
    // senao um segundo fator revogado continuaria valendo.
    const primeira = await servico.iniciarInscricao(USER_ID, EMAIL);
    banco.registro.mfaStatus = 'ENABLED';

    const segunda = await servico.iniciarInscricao(USER_ID, EMAIL);

    expect(segunda.base32).not.toBe(primeira.base32);
    expect(banco.registro.mfaStatus).toBe('PENDING');
  });
});
