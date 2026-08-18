import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega por conta propria; o
// vitest nao, entao a carga acontece aqui, antes de qualquer suite abrir
// client.
//
// fileURLToPath, e nao url.pathname: em Windows o pathname vem como
// "/C:/..." e quebra.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

/**
 * Banco DEDICADO aos testes de integracao -- card [INFRA], issue #101.
 *
 * Mesmo redirecionamento de `apps/api/test/setup-env.ts`, e duplicado de
 * proposito: sao dois runners (vitest aqui, Jest la) em pacotes separados, e
 * um pacote compartilhado para seis linhas custa mais do que resolve. Mexeu
 * aqui, mexa la.
 *
 * As suites de integracao escrevem em Postgres de verdade e a maioria NAO
 * limpa o que cria. Apontadas para o `DATABASE_URL` de desenvolvimento,
 * encheram o banco com 1086 tenants de teste (`academia-ada28f0e`,
 * `rede-a-ada28f0e`) -- o painel passou a exibir o rastro da suite em vez do
 * produto.
 *
 * Sem a variavel, cai no `DATABASE_URL`. A integracao nao recria banco, entao
 * o estrago de cair no de desenvolvimento e sujeira, nao perda -- diferente do
 * E2E, onde a ausencia da variavel e erro porque la roda `migrate reset`.
 */
const urlDaIntegracao = process.env['INTEGRATION_DATABASE_URL'];

if (urlDaIntegracao) {
  process.env['DATABASE_URL'] = urlDaIntegracao;
}
