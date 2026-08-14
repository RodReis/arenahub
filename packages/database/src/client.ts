import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

export type PrismaClientArenaHub = PrismaClient;

/**
 * Cria o client do Prisma.
 *
 * Factory, e nao singleton exportado, por dois motivos praticos:
 *
 *   - teste de integracao precisa de client apontando para outro banco
 *     (Testcontainers), sem depender de variavel de ambiente global;
 *   - quem controla o ciclo de vida da conexao e a aplicacao -- no NestJS,
 *     o modulo; no script, o proprio script. Singleton em modulo esconde
 *     `$disconnect` e vaza conexao em teste.
 *
 * O driver adapter e OBRIGATORIO no Prisma 7 -- `datasources` deixou de
 * existir. E consequencia direta de o client ter virado TypeScript puro,
 * sem engine binario nativo: a conexao passa a ser responsabilidade de um
 * driver do ecossistema Node (`pg`, aqui).
 *
 * `url` omitida cai em DATABASE_URL.
 */
export function criarPrismaClient(opcoes: { url?: string } = {}): PrismaClientArenaHub {
  const connectionString = opcoes.url ?? process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL nao definida. Copie .env.example para .env na raiz do ' +
        'monorepo, ou passe `url` explicitamente.',
    );
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
