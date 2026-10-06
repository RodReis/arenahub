import { randomBytes } from 'node:crypto';

import { describe, expect, it, beforeEach } from '@jest/globals';

import { CifradorDeSegredo } from './segredo-cifrado.js';
import {
  CodigoMfaInvalidoError,
  CodigoMfaReutilizadoError,
  MfaObrigatorioError,
  MfaService,
} from './mfa.service.js';
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
      // Mesma condicao do banco: so grava se o contador novo for maior.
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        const novo = data['mfaLastCounter'] as bigint;
        if (registro.mfaLastCounter !== null && registro.mfaLastCounter >= novo) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(registro, data);
        return Promise.resolve({ count: 1 });
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

  /** Codigo valido do segredo hoje gravado, `passos` janelas de 30 s a frente. */
  function codigoDoSegredoAtual(passos: number): string {
    const segredo = new CifradorDeSegredo(CHAVE).decifrar({
      ciphertext: Buffer.from(banco.registro.mfaSecretCiphertext!),
      iv: Buffer.from(banco.registro.mfaSecretIv!),
      tag: Buffer.from(banco.registro.mfaSecretTag!),
    });

    return new TotpService().gerarCodigo(segredo, Math.floor(Date.now() / 1000) + passos * 30);
  }

  describe('trocar um fator ENABLED', () => {
    beforeEach(async () => {
      await servico.iniciarInscricao(USER_ID, EMAIL);
      await servico.confirmarInscricao(USER_ID, codigoDoSegredoAtual(0));
    });

    it('recusa quem tem so a sessao e nao manda codigo (defeito #578)', async () => {
      const segredoAntes = Buffer.from(banco.registro.mfaSecretCiphertext!);

      await expect(servico.iniciarInscricao(USER_ID, EMAIL)).rejects.toBeInstanceOf(
        MfaObrigatorioError,
      );

      expect(banco.registro.mfaStatus).toBe('ENABLED');
      expect(Buffer.from(banco.registro.mfaSecretCiphertext!).equals(segredoAntes)).toBe(true);
    });

    it('recusa codigo errado e mantem o fator atual', async () => {
      await expect(servico.iniciarInscricao(USER_ID, EMAIL, '000000')).rejects.toBeInstanceOf(
        CodigoMfaInvalidoError,
      );

      expect(banco.registro.mfaStatus).toBe('ENABLED');
    });

    it('com o codigo do fator atual gera segredo novo e volta a PENDING', async () => {
      const antes = Buffer.from(banco.registro.mfaSecretCiphertext!);

      await servico.iniciarInscricao(USER_ID, EMAIL, codigoDoSegredoAtual(1));

      expect(banco.registro.mfaStatus).toBe('PENDING');
      expect(Buffer.from(banco.registro.mfaSecretCiphertext!).equals(antes)).toBe(false);
    });
  });
});

describe('MfaService.verificar', () => {
  let banco: ReturnType<typeof criarBanco>;
  let servico: MfaService;

  beforeEach(() => {
    banco = criarBanco();
    servico = new MfaService(banco as never, new TotpService(), new CifradorDeSegredo(CHAVE));
  });

  function codigo(passos = 0): string {
    const segredo = new CifradorDeSegredo(CHAVE).decifrar({
      ciphertext: Buffer.from(banco.registro.mfaSecretCiphertext!),
      iv: Buffer.from(banco.registro.mfaSecretIv!),
      tag: Buffer.from(banco.registro.mfaSecretTag!),
    });

    return new TotpService().gerarCodigo(segredo, Math.floor(Date.now() / 1000) + passos * 30);
  }

  it('recusa codigo de segredo PENDING: o dono ainda nao provou o fator (defeito #578)', async () => {
    await servico.iniciarInscricao(USER_ID, EMAIL);

    await expect(servico.verificar(USER_ID, codigo())).rejects.toBeInstanceOf(
      CodigoMfaInvalidoError,
    );
  });

  it('aceita codigo de fator ENABLED', async () => {
    await servico.iniciarInscricao(USER_ID, EMAIL);
    await servico.confirmarInscricao(USER_ID, codigo(0));

    await expect(servico.verificar(USER_ID, codigo(1))).resolves.toBeUndefined();
  });

  it('dois envios simultaneos do mesmo codigo: so um passa (defeito #582.4)', async () => {
    await servico.iniciarInscricao(USER_ID, EMAIL);
    await servico.confirmarInscricao(USER_ID, codigo(0));

    const mesmoCodigo = codigo(1);
    const resultados = await Promise.allSettled([
      servico.verificar(USER_ID, mesmoCodigo),
      servico.verificar(USER_ID, mesmoCodigo),
    ]);

    const aceitos = resultados.filter((r) => r.status === 'fulfilled');
    const recusados = resultados.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(aceitos).toHaveLength(1);
    expect(recusados[0]?.reason).toBeInstanceOf(CodigoMfaReutilizadoError);
  });
});
