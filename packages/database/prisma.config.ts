import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// O .env vive na raiz do monorepo, nao neste pacote -- e a mesma fonte que o
// docker-compose usa. Sem este caminho explicito, o Prisma procuraria em
// packages/database/.env e nao acharia DATABASE_URL.
//
// fileURLToPath, e nao url.pathname: em Windows o pathname vem como
// "/C:/..." e quebra.
//
// ORDEM IMPORTA: esta chamada tem de vir antes do defineConfig abaixo, que
// le DATABASE_URL na avaliacao. Mover para depois faz a config carregar
// vazia, e o erro aparece como "datasource sem url" -- sem apontar para
// aqui. Nao reordene.
carregarEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

type Env = {
  DATABASE_URL: string;
};

/**
 * `prisma generate` NAO abre conexao -- le o schema e escreve o client. Mas o
 * `env()` do Prisma resolve a datasource ao CARREGAR esta config, entao sem a
 * variavel ele morre com `PrismaConfigEnvError` antes de gerar nada.
 *
 * O placeholder existe so para esse caminho. Nao e fallback silencioso: e uma
 * URL que nao resolve para host nenhum, entao qualquer comando que de fato
 * TOQUE o banco (`migrate`, `studio`, `db push`) falha na conexao, alto e
 * claro, em vez de escrever no lugar errado.
 *
 * Sem isto, todo consumidor precisa injetar um DATABASE_URL de mentira antes
 * de gerar o client -- o CI ja fazia isso num passo dedicado, e o mesmo
 * problema reapareceu no build de deploy e no `typecheck` (F58).
 */
const URL_SO_PARA_GENERATE = 'postgresql://prisma:generate@127.0.0.1:1/nao-conecta';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ? env<Env>('DATABASE_URL') : URL_SO_PARA_GENERATE,
  },
});
