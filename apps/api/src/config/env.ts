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

  /**
   * Qualificacao da CONTRATADA (RRB TRADING) no contrato -- F70 (ADR-055 §6).
   *
   * CONFIGURACAO, e nao literal em `contrato-pdf.service.ts`: endereco e
   * representante mudam por ato societario, e trocar endereco da empresa nao
   * pode exigir deploy.
   *
   * TODAS OPCIONAIS no schema, com placeholder visivel como padrao -- a
   * SPEC-070 §7 registra que nome, CNPJ, endereco e representante da RRB
   * TRADING sao lacuna do PI, nao dado que o Code inventa. Sem a variavel, o
   * PDF sai com `[a definir pelo PI]` no campo que falta, em vez de "não
   * informado" silencioso -- e o painel recusa ATIVAR contrato com a lacuna
   * (ver `tenant-contract.use-case.ts`).
   */
  CONTRATADA_RAZAO_SOCIAL: z.string().optional(),
  CONTRATADA_CNPJ: z.string().optional(),
  CONTRATADA_ENDERECO: z.string().optional(),
  CONTRATADA_REPRESENTANTE: z.string().optional(),
  CONTRATADA_EMAIL: z.string().optional(),

  /**
   * ---------------------------------------------------------------------
   * PILOTO DO APP E DO TOTEM -- F29, Slice 4.7.
   * ---------------------------------------------------------------------
   *
   * VARIAVEL, e nao constante: desligar o pagamento no app as 22h de um
   * sabado nao pode exigir build, revisao de loja e atualizacao do aluno.
   *
   * TODAS AS FLAGS NASCEM DESLIGADAS, e a ausencia FECHA -- ver
   * `politica-de-versao.ts`. Abrir na duvida transformaria erro de deploy
   * em ausencia silenciosa de controle: tudo continua funcionando e
   * ninguem descobre que o freio sumiu.
   */

  /** Menor versao do app que ainda roda. Ausente = ninguem passa. */
  MOBILE_MIN_VERSION: z.string().optional(),
  /** Ate quando a versao abaixo da minima ainda funciona (ISO 8601). */
  MOBILE_VERSION_GRACE_UNTIL: z.string().datetime().optional(),
  /** Para onde mandar o aluno atualizar. Precisa ser https. */
  MOBILE_UPDATE_URL: z.string().optional(),

  /**
   * `z.coerce.boolean()` NAO serve aqui: ele converte toda string nao vazia
   * em `true`, e `FEATURE_KIOSK=false` ligaria o totem. A comparacao
   * explicita com `'true'` e o que faz a flag significar o que esta escrito.
   */
  FEATURE_STUDENT_MOBILE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FEATURE_MOBILE_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FEATURE_KIOSK: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FEATURE_KIOSK_PAYMENTS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /**
   * Push externo. Fica DESLIGADO ate existir credencial do OneSignal
   * (provedor escolhido pelo PI em 14/09/2026).
   *
   * Desligado NAO tira funcionalidade do aluno: a caixa interna e a entrega
   * e o push e so um atalho ate ela.
   */
  FEATURE_PUSH_NOTIFICATIONS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
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
  /**
   * Qualificacao da CONTRATADA no contrato -- F70 (ADR-055 §6).
   *
   * `null` no campo cujo dado o PI ainda nao passou (SPEC-070 §7): o gerador
   * de PDF imprime placeholder visivel nesse campo, nunca "não informado"
   * silencioso.
   */
  contratada: {
    razaoSocial: string | null;
    cnpj: string | null;
    endereco: string | null;
    representante: string | null;
    email: string | null;
  };
  /**
   * Piloto do app e do totem -- F29, Slice 4.7.
   *
   * `null` e `false` sao os padroes SEGUROS: sem versao minima ninguem passa,
   * e funcionalidade sem flag fica desligada. A regra que le isto
   * (`politica-de-versao.ts`) fecha na ausencia de proposito.
   */
  canais: {
    versaoMinima: string | null;
    carenciaAte: string | null;
    urlDeAtualizacao: string | null;
    funcionalidades: {
      STUDENT_MOBILE: boolean;
      MOBILE_PAYMENTS: boolean;
      KIOSK: boolean;
      KIOSK_PAYMENTS: boolean;
      PUSH_NOTIFICATIONS: boolean;
    };
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
    contratada: {
      razaoSocial: bruto.CONTRATADA_RAZAO_SOCIAL ?? null,
      cnpj: bruto.CONTRATADA_CNPJ ?? null,
      endereco: bruto.CONTRATADA_ENDERECO ?? null,
      representante: bruto.CONTRATADA_REPRESENTANTE ?? null,
      email: bruto.CONTRATADA_EMAIL ?? null,
    },
    canais: {
      versaoMinima: bruto.MOBILE_MIN_VERSION ?? null,
      carenciaAte: bruto.MOBILE_VERSION_GRACE_UNTIL ?? null,
      urlDeAtualizacao: bruto.MOBILE_UPDATE_URL ?? null,
      funcionalidades: {
        STUDENT_MOBILE: bruto.FEATURE_STUDENT_MOBILE,
        MOBILE_PAYMENTS: bruto.FEATURE_MOBILE_PAYMENTS,
        KIOSK: bruto.FEATURE_KIOSK,
        KIOSK_PAYMENTS: bruto.FEATURE_KIOSK_PAYMENTS,
        PUSH_NOTIFICATIONS: bruto.FEATURE_PUSH_NOTIFICATIONS,
      },
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
