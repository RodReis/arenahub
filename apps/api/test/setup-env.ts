import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega por conta propria; o Jest
// nao, entao a carga acontece aqui, antes de qualquer suite subir modulo.
//
// fileURLToPath, e nao url.pathname: em Windows o pathname vem como
// "/C:/..." e quebra.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

/**
 * Banco DEDICADO a integracao -- card [INFRA], issue #101.
 *
 * Mesmo redirecionamento de `packages/database/test/setup-env.ts`, e duplicado
 * de proposito: sao dois runners (Jest aqui, vitest la) em pacotes separados, e
 * um pacote compartilhado para seis linhas custa mais do que resolve. Mexeu
 * aqui, mexa la.
 *
 * As suites de integracao escrevem em Postgres de verdade, e a maioria NAO
 * limpa o que cria: de 20 suites, 3 apagam o tenant no fim. As outras 17
 * deixam. Apontadas para o `DATABASE_URL` de desenvolvimento, encheram o banco
 * com 1062 tenants de teste (`f7-rede-a-a6b8b550`, `academia-2d849fb4`) e 3752
 * alunos -- o painel passou a exibir o rastro da suite em vez do produto.
 *
 * O `docs/TESTING.md` dizia que aqui havia Testcontainers. Nao ha: e o mesmo
 * Postgres local, pelo mesmo `DATABASE_URL`.
 *
 * `INTEGRATION_DATABASE_URL` separa. Banco proprio, e NAO o mesmo do E2E:
 * rodar as duas suites ao mesmo tempo faria uma derrubar o banco sob os pes da
 * outra.
 *
 * Sem a variavel, cai no `DATABASE_URL` -- diferente do E2E, onde a ausencia e
 * erro. O motivo e a assimetria de dano: a integracao LIMPA parcialmente e nao
 * recria banco, enquanto o E2E dispara `migrate reset`. Aqui, cair no banco de
 * desenvolvimento suja; la, apagaria.
 */
const urlDaIntegracao = process.env['INTEGRATION_DATABASE_URL'];

if (urlDaIntegracao) {
  process.env['DATABASE_URL'] = urlDaIntegracao;
}

/**
 * A integracao monta cenario pelo ROLE DONO, e nao pelo role restrito de RLS
 * (F66, ADR-054).
 *
 * O `PrismaService` prefere `RUNTIME_DATABASE_URL` quando ela existe. Aqui
 * ela e apagada de proposito: as suites criam aluno, plano e dispositivo
 * chamando o client DIRETO, fora de qualquer requisicao HTTP -- entao nao ha
 * escopo de tenant aberto, e a politica recusa a escrita com `42501`. Sao 51
 * pontos em cerca de vinte arquivos, todos montando cenario, nenhum
 * exercitando isolamento.
 *
 * Isso NAO afrouxa a prova da politica: quem a prova e
 * `rls-isolation.int-spec.ts`, que abre o proprio client no role restrito
 * por `RUNTIME_INTEGRATION_DATABASE_URL` e PULA se ela nao existir, em vez de
 * cair no dono e passar em falso.
 */
delete process.env['RUNTIME_DATABASE_URL'];
