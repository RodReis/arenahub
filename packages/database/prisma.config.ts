import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// O .env vive na raiz do monorepo, nao neste pacote -- e a mesma fonte que o
// docker-compose usa. Sem este caminho explicito, o Prisma procuraria em
// packages/database/.env e nao acharia DATABASE_URL.
//
// fileURLToPath, e nao url.pathname: em Windows o pathname vem como
// "/C:/..." e quebra.
carregarEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
});
