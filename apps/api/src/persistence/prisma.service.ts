import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient, PrismaPg } from '@arenahub/database';

/**
 * Client do Prisma com ciclo de vida amarrado ao do modulo.
 *
 * O `client.ts` do pacote de banco e explicito: quem chama a factory e dono
 * do pool, e esquecer `$disconnect` segura o processo de pe e vaza conexao
 * em teste ate estourar o limite do Postgres. Aqui o dono e o Nest.
 *
 * ESTENDE o client em vez de embrulha-lo. Delegar model a model exigiria
 * anotar o tipo de cada um a mao -- o tipo gerado pelo Prisma nao e
 * nomeavel de fora do pacote (TS2742) -- e cada modelo novo viraria uma
 * linha nova aqui, esquecida na primeira pressa.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env['DATABASE_URL'];

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL nao definida. Copie .env.example para .env na raiz do monorepo.',
      );
    }

    // Driver adapter e obrigatorio no Prisma 7: o client virou TypeScript
    // puro, sem engine binario, e a conexao passa a ser de um driver do
    // ecossistema Node.
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
