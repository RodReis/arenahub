/**
 * Carga da decisao online -- `M1-NFR-003`, plano F9 Task 6 Step 1.
 *
 * `M1-NFR-003` pede suportar **10x o pico medido da primeira unidade**. Como
 * a unidade piloto ainda nao opera, o numero de pico nao existe -- e inventar
 * um seria pior que nao ter: viraria "aprovado" num relatorio sem nada por
 * tras.
 *
 * O que este script faz e medir a CAPACIDADE ATUAL contra uma baseline
 * conservadora declarada, para que exista um numero real antes do piloto. O
 * pico medido substitui a baseline assim que a unidade operar, e o teste roda
 * de novo -- sem mudar o script, so a variavel.
 *
 * COMO RODAR
 * ----------
 *   1. `pnpm docker:up`
 *   2. **Fixe `MFA_ENCRYPTION_KEY` no `.env` da raiz** (32 bytes em base64):
 *      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
 *   3. `pnpm --filter @arenahub/api dev`   (porta 3344)
 *   4. `pnpm --filter @arenahub/api test:load:access`
 *
 * O passo 2 nao e opcional. Sem a variavel, `carregarConfig` gera
 * `randomBytes(32)` a cada arranque (comportamento correto para dev: cada
 * reinicio invalida os segredos anteriores). Mas isso significa que o script
 * cifra a credencial com UMA chave e a API a decifra com OUTRA -- e a carga
 * inteira volta 401, medindo a velocidade da rejeicao.
 *
 * O script semeia o proprio tenant, Edge, dispositivo, aluno e direito. Nao
 * depende do seed de bancada: carga que compartilha dado com teste manual
 * mede as duas coisas juntas.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import autocannon from 'autocannon';
import { config as carregarEnv } from 'dotenv';

import { assinar, CABECALHOS } from '@arenahub/api-contracts';

// ORDEM IMPORTA, como no `main.ts`: o `.env` da raiz precisa estar carregado
// ANTES de qualquer import que leia `process.env` -- e `criarPrismaClient` e
// `carregarConfig` leem. Por isso os dois entram por import dinamico abaixo.
carregarEnv({ path: join(process.cwd(), '../../.env') });

const { criarPrismaClient } = await import('@arenahub/database');
const { CifradorDeSegredo } = await import('../../src/modules/auth/segredo-cifrado.js');
const { carregarConfig } = await import('../../src/config/env.js');

const BASE_URL = process.env['LOAD_BASE_URL'] ?? 'http://127.0.0.1:3344';
const CAMINHO = '/api/v1/edge/access-decisions';

/**
 * Baseline conservadora, em requisicoes por segundo.
 *
 * Uma catraca de academia movimentada faz ~1 passagem a cada 3 s no horario
 * de pico, ou seja ~0,33 req/s por catraca. Com folga para varias catracas na
 * mesma unidade, 5 req/s cobre a operacao real com margem.
 *
 * O alvo de `M1-NFR-003` e 10x isso.
 */
const BASELINE_RPS = Number(process.env['LOAD_BASELINE_RPS'] ?? 5);
const ALVO_RPS = BASELINE_RPS * 10;

/** 15 min no plano; encurtavel para iteracao local. */
const DURACAO_S = Number(process.env['LOAD_DURACAO_S'] ?? 60);
const CONEXOES = Number(process.env['LOAD_CONEXOES'] ?? 20);

/** Proporcao de ALLOW. O resto e DENY, que e caminho mais curto. */
const FRACAO_ALLOW = 0.7;

/** `{iv}:{tag}:{ciphertext}` em base64 -- mesmo formato do `EdgeAuthService`. */
function cifrarParaColuna(cifrador: InstanceType<typeof CifradorDeSegredo>, segredo: string): string {
  const cifrado = cifrador.cifrar(Buffer.from(segredo, 'utf8'));

  return [
    cifrado.iv.toString('base64'),
    cifrado.tag.toString('base64'),
    cifrado.ciphertext.toString('base64'),
  ].join(':');
}

interface ContextoDeCarga {
  tenantId: string;
  deviceId: string;
  keyId: string;
  segredo: string;
}

async function semear(db: ReturnType<typeof criarPrismaClient>): Promise<ContextoDeCarga> {
  const sufixo = randomUUID().slice(0, 8);

  const tenant = await db.tenant.create({
    data: {
      slug: `load-${sufixo}`,
      legalName: 'Carga LTDA',
      displayName: 'Carga',
    },
  });

  const unidade = await db.gymUnit.create({
    data: {
      tenantId: tenant.id,
      code: 'CARGA',
      name: 'Carga',
      timezone: 'America/Sao_Paulo',
      openingHours: {},
    },
  });

  const node = await db.edgeNode.create({
    data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-LOAD-${sufixo}` },
  });

  const segredo = randomBytes(32).toString('base64url');
  const keyId = `key-load-${sufixo}`;

  // Cifra com o MESMO cifrador da API, nao com uma reimplementacao: chave ou
  // formato divergente produziria 401, e o teste mediria a velocidade da
  // rejeicao em vez da decisao -- com o grafico bonito do mesmo jeito.
  const cifrador = new CifradorDeSegredo(carregarConfig().mfa.chave);

  await db.edgeCredential.create({
    data: {
      tenantId: tenant.id,
      edgeNodeId: node.id,
      keyId,
      encryptedSecret: cifrarParaColuna(cifrador, segredo),
      activeFrom: new Date(Date.now() - 60_000),
    },
  });

  const dispositivo = await db.device.create({
    data: {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      edgeNodeId: node.id,
      kind: 'FACIAL_READER',
      model: 'Inner Fit',
      serial: `SER-LOAD-${sufixo}`,
    },
  });

  const documento = await db.consentDocument.create({
    data: {
      tenantId: tenant.id,
      type: 'BIOMETRIC',
      version: 1,
      purpose: 'Carga',
      content: 'Termo de carga. '.repeat(5),
      contentSha256: 'd'.repeat(64),
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });

  const aluno = await db.student.create({
    data: {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      membershipNumber: `ML-${sufixo}`,
      fullName: 'Aluno Carga',
      birthDate: new Date('1990-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
    },
  });

  const consentimento = await db.consentRecord.create({
    data: {
      tenantId: tenant.id,
      studentId: aluno.id,
      documentId: documento.id,
      subjectKind: 'STUDENT',
      decision: 'ACCEPTED',
      subjectAgeYears: 36,
      occurredAt: new Date(),
    },
  });

  const identidade = await db.biometricIdentity.create({
    data: {
      tenantId: tenant.id,
      studentId: aluno.id,
      consentRecordId: consentimento.id,
      state: 'ACTIVE',
    },
  });

  await db.deviceUser.create({
    data: {
      tenantId: tenant.id,
      deviceId: dispositivo.id,
      studentId: aluno.id,
      identityId: identidade.id,
      externalUserId: '1',
      state: 'SYNCED',
    },
  });

  const entitlement = await db.entitlement.create({
    data: {
      tenantId: tenant.id,
      studentId: aluno.id,
      source: 'SUBSCRIPTION',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000 * 30),
      policySnapshot: {},
    },
  });

  await db.entitlementUnitWindow.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
      entitlementId: entitlement.id,
      gymUnitId: unidade.id,
      dayOfWeek: dia,
      startMinute: 0,
      endMinute: 1439,
    })),
  });

  return { tenantId: tenant.id, deviceId: dispositivo.id, keyId, segredo };
}

function montarRequisicao(ctx: ContextoDeCarga) {
  // `externalUserId` alterna entre o aluno com direito (ALLOW) e um id que
  // nao existe (DENY). Mistura representativa: medir so o caminho feliz
  // esconderia o custo do caminho que a operacao mais ve em dia ruim.
  const allow = Math.random() < FRACAO_ALLOW;

  const corpo = JSON.stringify({
    deviceId: ctx.deviceId,
    externalUserId: allow ? '1' : '99999',
    recognitionId: `rec-${randomUUID()}`,
    recognizedAt: new Date().toISOString(),
    // Chave unica por requisicao: reusar faria o teste medir o atalho de
    // idempotencia, nao a decisao.
    idempotencyKey: `load-${randomUUID()}`,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('base64url');

  const assinatura = assinar(
    {
      keyId: ctx.keyId,
      timestamp,
      nonce,
      method: 'POST',
      pathAndQuery: CAMINHO,
      body: corpo,
    },
    ctx.segredo,
  );

  return {
    body: corpo,
    headers: {
      'content-type': 'application/json',
      [CABECALHOS.keyId]: ctx.keyId,
      [CABECALHOS.timestamp]: String(timestamp),
      [CABECALHOS.nonce]: nonce,
      [CABECALHOS.signature]: assinatura,
    },
  };
}

/**
 * Saida do relatorio.
 *
 * `process.stdout.write` em vez de `console.log`: a regra `no-console` existe
 * para pegar log esquecido em codigo de servidor, e afrouxa-la para este
 * arquivo abriria a excecao para o resto. Aqui a saida E o produto do script,
 * entao escrever direto no descritor e mais honesto que pedir excecao.
 */
function imprimir(linha: string): void {
  process.stdout.write(`${linha}
`);
}

function imprimirErro(linha: string): void {
  process.stderr.write(`${linha}
`);
}

async function main(): Promise<void> {
  // Falha cedo e com instrucao: sem a chave fixa, a corrida inteira volta
  // 401 e o relatorio sairia com "0 eventos gravados" sem dizer por que.
  if (!process.env['MFA_ENCRYPTION_KEY']) {
    imprimirErro([
        'MFA_ENCRYPTION_KEY ausente. Sem ela, a API gera uma chave nova a cada',
        'arranque e nao consegue decifrar a credencial que este script grava.',
        '',
        'Gere e ponha no `.env` da raiz, ANTES de subir a API:',
        '  node -e "imprimir(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      ].join('\n'),
    );
    process.exit(1);
  }

  const db = criarPrismaClient();

  imprimir('semeando dados de carga...');

  const ctx = await semear(db);

  imprimir(`alvo: ${ALVO_RPS} req/s (10x baseline de ${BASELINE_RPS} req/s)`);
  imprimir(`duracao: ${DURACAO_S}s, conexoes: ${CONEXOES}`);

  const instancia = autocannon({
    url: `${BASE_URL}${CAMINHO}`,
    method: 'POST',
    connections: CONEXOES,
    duration: DURACAO_S,
    // `overallRate` fixa a taxa alvo em vez de saturar: o que `M1-NFR-003`
    // pergunta e "aguenta 10x o pico?", nao "qual o maximo absoluto?".
    overallRate: ALVO_RPS,
    // Cada requisicao precisa de assinatura NOVA: o HMAC leva timestamp e
    // nonce, e nonce repetido e recusado como replay. Um corpo fixo mediria a
    // velocidade do 401, com o grafico bonito do mesmo jeito.
    //
    // `response` e o gancho disponivel nesta versao: reescreve a requisicao
    // do cliente logo apos cada resposta, antes do proximo disparo.
    setupClient: (client: autocannon.Client) => {
      const renovar = (): void => {
        const montada = montarRequisicao(ctx);

        client.setHeadersAndBody(montada.headers, montada.body);
      };

      renovar();
      client.on('response', renovar);
    },
  });

  autocannon.track(instancia as unknown as autocannon.Instance, {
    renderProgressBar: true,
  });

  const resultado = await instancia;

  const naoDoisXX = resultado.non2xx ?? 0;
  const erros = (resultado.errors ?? 0) + (resultado.timeouts ?? 0);

  imprimir('\n--- resultado ---');
  imprimir(`req/s medio:      ${resultado.requests.average.toFixed(1)}`);
  imprimir(`latencia p50:     ${resultado.latency.p50} ms`);
  imprimir(`latencia p97.5:   ${resultado.latency.p97_5} ms`);
  imprimir(`latencia p99:     ${resultado.latency.p99} ms`);
  imprimir(`latencia max:     ${resultado.latency.max} ms`);
  imprimir(`respostas nao-2xx: ${naoDoisXX}`);
  imprimir(`erros/timeouts:   ${erros}`);

  const eventos = await db.accessEvent.count({ where: { tenantId: ctx.tenantId } });

  imprimir(`eventos gravados: ${eventos}`);

  await db.$disconnect();

  // O criterio de aprovacao e explicito, e o script FALHA quando nao bate.
  // Relatorio que so imprime numero deixa a interpretacao para quem le com
  // pressa -- e "passou" vira o default.
  const falhas = [];

  if (naoDoisXX > 0) falhas.push(`${naoDoisXX} respostas nao-2xx`);
  if (erros > 0) falhas.push(`${erros} erros ou timeouts`);
  if (resultado.requests.average < ALVO_RPS * 0.95) {
    falhas.push(
      `taxa media ${resultado.requests.average.toFixed(1)} abaixo do alvo ${ALVO_RPS}`,
    );
  }

  if (falhas.length > 0) {
    imprimirErro(`\nREPROVADO: ${falhas.join('; ')}`);
    process.exit(1);
  }

  imprimir('\nAPROVADO para a baseline declarada.');
}

main().catch((erro: unknown) => {
  imprimirErro(String(erro));
  process.exit(1);
});
