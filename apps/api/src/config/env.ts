import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { z } from 'zod';

/**
 * Configuracao validada no boundary (`CLAUDE.md`, Stack: Zod no boundary).
 *
 * Falta de variavel obrigatoria derruba o processo no arranque, e nao na
 * primeira requisicao que precisar dela -- erro de configuracao tem de
 * aparecer no deploy, nao para o usuario.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_ISSUER: z.string().default('arenahub'),
  JWT_AUDIENCE: z.string().default('arenahub-admin'),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  /** 32 bytes em base64, para AES-256-GCM do segredo TOTP. */
  MFA_ENCRYPTION_KEY: z.string().optional(),
});

export interface ConfigDaApi {
  ambiente: 'development' | 'test' | 'production';
  jwt: {
    chavePrivada: string;
    chavePublica: string;
    emissor: string;
    audiencia: string;
  };
  /** Chave AES-256 para o segredo TOTP. */
  mfa: { chave: Buffer };
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): ConfigDaApi {
  const bruto = esquema.parse(env);

  const par = resolverChaves(bruto);

  return {
    ambiente: bruto.NODE_ENV,
    jwt: {
      chavePrivada: par.privada,
      chavePublica: par.publica,
      emissor: bruto.JWT_ISSUER,
      audiencia: bruto.JWT_AUDIENCE,
    },
    mfa: { chave: resolverChaveDeMfa(bruto) },
  };
}

/**
 * Mesma regra da chave JWT: obrigatoria em producao, efemera fora dela.
 *
 * Chave efemera invalida os segredos TOTP ja gravados a cada reinicio -- o
 * que e correto em desenvolvimento e inaceitavel em producao, onde perder a
 * chave significa trancar todo mundo fora da propria conta.
 */
function resolverChaveDeMfa(bruto: z.infer<typeof esquema>): Buffer {
  if (bruto.MFA_ENCRYPTION_KEY) {
    return Buffer.from(bruto.MFA_ENCRYPTION_KEY, 'base64');
  }

  if (bruto.NODE_ENV === 'production') {
    throw new Error(
      'MFA_ENCRYPTION_KEY e obrigatoria em producao: 32 bytes em base64. ' +
        'Perder esta chave inutiliza todo segredo TOTP ja cadastrado.',
    );
  }

  return randomBytes(32);
}

/**
 * Em producao a chave e obrigatoria e vem do ambiente.
 *
 * Fora dela, gera um par efemero no arranque: cada reinicio invalida os
 * tokens anteriores, o que e exatamente o que se quer em desenvolvimento e
 * teste. Ter uma chave de exemplo versionada seria pior -- chave de exemplo
 * vira chave de producao no primeiro deploy apressado.
 */
function resolverChaves(bruto: z.infer<typeof esquema>): { privada: string; publica: string } {
  if (bruto.JWT_PRIVATE_KEY && bruto.JWT_PUBLIC_KEY) {
    return { privada: bruto.JWT_PRIVATE_KEY, publica: bruto.JWT_PUBLIC_KEY };
  }

  if (bruto.NODE_ENV === 'production') {
    throw new Error(
      'JWT_PRIVATE_KEY e JWT_PUBLIC_KEY sao obrigatorias em producao. ' +
        'Gere um par RSA 2048 e injete pelo ambiente -- nunca versione a chave.',
    );
  }

  const par = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  return { privada: par.privateKey, publica: par.publicKey };
}
