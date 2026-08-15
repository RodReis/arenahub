import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega por conta propria; o Jest
// nao, entao a carga acontece aqui, antes de qualquer suite subir modulo.
//
// fileURLToPath, e nao url.pathname: em Windows o pathname vem como
// "/C:/..." e quebra.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
