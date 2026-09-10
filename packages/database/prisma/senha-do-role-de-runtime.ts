/**
 * Seta a senha do role de runtime `arenahub_app` (F66, ADR-054).
 *
 * A migration CRIA o role, mas nao a senha: credencial nao se versiona, nem
 * em desenvolvimento. Sem senha o role existe e nao loga, e o teste de
 * isolamento PULA -- verde sem provar nada, que e o pior desfecho possivel
 * para uma fatia cujo objeto e justamente o isolamento.
 *
 * `ALTER ROLE` vale para o cluster inteiro, entao uma execucao cobre todos os
 * bancos (`arenahub`, `arenahub_int`, `arenahub_e2e`).
 *
 * Pelo Prisma, e nao por `psql`: o job de CI roda no container do Playwright,
 * que nao traz cliente do Postgres. Mesmo motivo do
 * `scripts/preparar-banco-de-teste.mjs`.
 *
 * Uso:
 *   pnpm --filter @arenahub/database exec tsx prisma/senha-do-role-de-runtime.ts <senha>
 *
 * Conecta pelo `DATABASE_URL` (role dono) -- so ele pode alterar outro role.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

import { criarPrismaClient } from '../src/client.js';

// O `.env` vive na raiz do monorepo. O CLI do Prisma carrega sozinho; `tsx`,
// nao -- mesmo motivo do `seed.ts`.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const senha = process.argv[2];

if (!senha) {
  console.error('Uso: tsx prisma/senha-do-role-de-runtime.ts <senha>');
  process.exit(1);
}

// Aspas simples dobradas: a senha entra num literal SQL, porque `ALTER ROLE`
// nao aceita parametro para ela. Em CI o valor e fixo; a defesa esta aqui
// para o dia em que alguem passar senha gerada.
const senhaEscapada = senha.replaceAll("'", "''");

const db = criarPrismaClient();

try {
  await db.$executeRawUnsafe(`ALTER ROLE arenahub_app WITH PASSWORD '${senhaEscapada}'`);
  console.log('[rls] senha do role arenahub_app definida.');
} finally {
  await db.$disconnect();
}
