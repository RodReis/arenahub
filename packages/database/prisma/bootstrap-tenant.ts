/* eslint-disable no-console -- programa de linha de comando: console e a interface, nao debug esquecido (mesma excecao de prisma/seed.ts e prisma/import-pacto.ts). */
/**
 * Bootstrap de tenant real -- SPEC-058 §6, issue #253.
 *
 *   BOOTSTRAP_TENANT_SLUG=arena-positiva \
 *   BOOTSTRAP_LEGAL_NAME="Complexo Arena Positiva LTDA" \
 *   BOOTSTRAP_DISPLAY_NAME="Arena Positiva" \
 *   BOOTSTRAP_UNIT_CODE=MATRIZ \
 *   BOOTSTRAP_UNIT_NAME="Unidade Matriz" \
 *   BOOTSTRAP_UNIT_TIMEZONE=America/Sao_Paulo \
 *   BOOTSTRAP_OWNER_EMAIL=dono@complexoarenapositiva.com.br \
 *   pnpm --filter @arenahub/database bootstrap:tenant
 *
 * DISTINTO do `seed.ts`: aquele grava dado FALSO de desenvolvimento
 * (`dono@arena-positiva.test`); este cria o PRIMEIRO tenant real a partir
 * de argumentos, com senha gerada e impressa UMA VEZ -- ela nao fica em
 * lugar nenhum depois deste console. Guarde-a antes de fechar o terminal.
 *
 * `criarPrismaClient` ja le `DATABASE_URL` do ambiente: apontar para
 * producao e so exportar a variavel antes de chamar, nenhuma URL fica
 * hardcoded aqui.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';
import { bootstrapar } from '../src/bootstrap-tenant/bootstrapar.js';

function lerVariavelObrigatoria(nome: string): string {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(`${nome} nao definida. Ver o cabecalho deste arquivo para a lista completa.`);
  }

  return valor;
}

async function executar(): Promise<void> {
  const args = {
    tenantSlug: lerVariavelObrigatoria('BOOTSTRAP_TENANT_SLUG'),
    legalName: lerVariavelObrigatoria('BOOTSTRAP_LEGAL_NAME'),
    displayName: lerVariavelObrigatoria('BOOTSTRAP_DISPLAY_NAME'),
    unitCode: lerVariavelObrigatoria('BOOTSTRAP_UNIT_CODE'),
    unitName: lerVariavelObrigatoria('BOOTSTRAP_UNIT_NAME'),
    timezone: lerVariavelObrigatoria('BOOTSTRAP_UNIT_TIMEZONE'),
    ownerEmail: lerVariavelObrigatoria('BOOTSTRAP_OWNER_EMAIL'),
  };

  const db = criarPrismaClient();

  try {
    const resultado = await bootstrapar(db, args);

    console.info(`[bootstrap-tenant] tenant ${args.tenantSlug} (${resultado.tenantId})`);
    console.info(`[bootstrap-tenant] unidade ${args.unitCode} (${resultado.gymUnitId})`);
    console.info(`[bootstrap-tenant] owner ${args.ownerEmail} (${resultado.ownerUserId})`);

    if (resultado.senhaGerada) {
      console.info('[bootstrap-tenant] SENHA INICIAL (exibida uma unica vez, guarde agora):');
      console.info(`[bootstrap-tenant]   ${resultado.senhaGerada}`);
      console.info('[bootstrap-tenant] MFA e obrigatorio no primeiro login (F6).');
    } else {
      console.info('[bootstrap-tenant] usuario ja existia -- nenhuma senha nova foi gerada.');
    }
  } finally {
    await db.$disconnect();
  }
}

try {
  await executar();
} catch (erro: unknown) {
  console.error('[bootstrap-tenant] falhou:', erro);
  process.exitCode = 1;
}
