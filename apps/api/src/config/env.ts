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

  REDIS_URL: z.string().optional(),

  STORAGE_ENDPOINT: z.string().default('http://127.0.0.1:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('arenahub-biometrics'),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  /**
   * Teto do arquivo de cadastro, em bytes. Padrao 5 MB.
   *
   * Parametro, nao constante: camera de recepcao e celular produzem tamanhos
   * muito diferentes, e apertar isto no codigo obrigaria deploy para ajustar.
   */
  STORAGE_MAX_ENROLLMENT_BYTES: z.coerce.number().int().positive().default(5_242_880),

  /** Validade da URL pre-assinada de cadastro, em segundos. Padrao 5 min. */
  STORAGE_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * Chave da API da Anthropic (extracao de laudo e analise assistiva, ADR-036).
   *
   * OPCIONAL de proposito, inclusive em producao: sem ela o modulo de saude
   * cai para o dublê de OCR/IA em vez de derrubar o processo -- a alternativa
   * (exigir a chave) tiraria do ar toda a Slice 3.3/3.5 por falta de uma
   * variavel que nao trava nenhuma outra funcionalidade da API. O aviso alto
   * de log fica a cargo de quem consome (`health.module.ts`), nao daqui.
   */
  ANTHROPIC_API_KEY: z.string().optional(),

  /**
   * Chave do Resend, para enviar o convite de usuario por e-mail (issue
   * #277, provedor decidido pelo PI em 05/09/2026).
   *
   * OPCIONAL, pelo mesmo criterio da chave da Anthropic acima: sem ela o
   * convite continua sendo criado e o LINK continua valendo -- o painel so
   * deixa de mandar o e-mail e diz isso na tela. Exigir a chave tiraria do ar
   * a criacao de usuario inteira por falta de uma variavel que nao trava
   * nenhuma outra funcionalidade.
   */
  RESEND_API_KEY: z.string().optional(),

  /**
   * Remetente do convite.
   *
   * O PADRAO E O DOMINIO DE TESTE DO RESEND (`onboarding@resend.dev`), por
   * decisao do PI em 05/09/2026: ele entrega SO para o e-mail dono da conta,
   * o que basta para provar o fluxo enquanto `arenapositiva.com` nao tem
   * SPF/DKIM publicados.
   *
   * Trocar para o dominio proprio e mudar ESTA variavel no ambiente -- nao ha
   * codigo a alterar. Sem o dominio verificado no Resend, um remetente
   * proprio faz o envio ser recusado pelo provedor.
   */
  RESEND_FROM: z.string().default('ArenaHub <onboarding@resend.dev>'),

  /**
   * Endereco publico do painel, usado para montar o link do convite no
   * e-mail.
   *
   * A API NAO SABE em que dominio o painel e servido -- ela responde a
   * localhost, ao dominio de producao e a um tunel, e nenhum deles esta no
   * corpo da requisicao. A tela resolve isso no cliente
   * (`window.location.origin`, issue #276), mas o e-mail sai do servidor e
   * precisa da resposta por configuracao.
   *
   * O padrao serve so ao desenvolvimento local; em producao a variavel e
   * obrigatoria de fato -- um link para `localhost` num e-mail enviado nao
   * abre para ninguem.
   */
  PANEL_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
});

/** Storage privado S3-compativel. MinIO em dev, S3 em producao. */
export interface ConfigDeStorage {
  endpoint: string;
  regiao: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Teto do arquivo de cadastro, em bytes. */
  maxBytesDeCadastro: number;
  /** Validade da URL pre-assinada, em segundos. */
  ttlDeUploadEmSegundos: number;
}

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
  redis: { url: string };
  storage: ConfigDeStorage;
  /** `null` quando a variavel nao esta definida -- nunca string vazia (INV-104). */
  anthropicApiKey: string | null;
  /** Envio de convite por e-mail (issue #277). */
  email: {
    /** `null` sem `RESEND_API_KEY` -- o convite nasce igual, so nao e enviado. */
    resendApiKey: string | null;
    remetente: string;
    /** Sem barra no fim: o caminho do convite ja comeca com uma. */
    urlDoPainel: string;
  };
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
    redis: { url: resolverRedisUrl(bruto) },
    storage: resolverStorage(bruto),
    anthropicApiKey: bruto.ANTHROPIC_API_KEY ?? null,
    email: {
      resendApiKey: bruto.RESEND_API_KEY ?? null,
      remetente: bruto.RESEND_FROM,
      urlDoPainel: bruto.PANEL_PUBLIC_URL.replace(/\/+$/, ''),
    },
  };
}

/**
 * Mesma regra das demais credenciais: obrigatoria em producao, padrao local
 * fora dela.
 *
 * O padrao `127.0.0.1` nunca aponta para um Redis de producao -- deixa-lo
 * passar em silencio faz o processo subir "com sucesso" contra um Redis que
 * nao existe (SPEC-058 AC-2).
 */
function resolverRedisUrl(bruto: z.infer<typeof esquema>): string {
  if (bruto.REDIS_URL) {
    return bruto.REDIS_URL;
  }

  if (bruto.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL e obrigatoria em producao. O padrao 127.0.0.1 so vale em desenvolvimento.',
    );
  }

  return 'redis://127.0.0.1:6379';
}

/**
 * Mesma regra das demais credenciais: obrigatoria em producao, padrao local
 * fora dela.
 *
 * O padrao aponta para o MinIO do `docker-compose.yml` com as credenciais de
 * desenvolvimento que ja estao la. Nao e segredo vazado -- e o mesmo valor
 * publico do compose, marcado como local. Em producao, a ausencia derruba o
 * arranque em vez de conectar anonimamente e falhar no primeiro cadastro.
 */
function resolverStorage(bruto: z.infer<typeof esquema>): ConfigDeStorage {
  const producao = bruto.NODE_ENV === 'production';

  if (producao && (!bruto.STORAGE_ACCESS_KEY_ID || !bruto.STORAGE_SECRET_ACCESS_KEY)) {
    throw new Error(
      'STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY sao obrigatorias em producao. ' +
        'O bucket guarda imagem de cadastro biometrico: acesso anonimo nao e opcao.',
    );
  }

  return {
    endpoint: bruto.STORAGE_ENDPOINT,
    regiao: bruto.STORAGE_REGION,
    bucket: bruto.STORAGE_BUCKET,
    accessKeyId: bruto.STORAGE_ACCESS_KEY_ID ?? 'arenahub',
    secretAccessKey: bruto.STORAGE_SECRET_ACCESS_KEY ?? 'arenahub_dev_minio',
    maxBytesDeCadastro: bruto.STORAGE_MAX_ENROLLMENT_BYTES,
    ttlDeUploadEmSegundos: bruto.STORAGE_UPLOAD_TTL_SECONDS,
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
