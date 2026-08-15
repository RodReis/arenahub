import { Injectable } from '@nestjs/common';

import { PrismaService } from '../persistence/prisma.service.js';

/**
 * Responde uma pergunta so: o banco atende agora?
 *
 * Isolado num provider porque readiness precisa ser substituivel em teste
 * sem subir Postgres.
 */
@Injectable()
export class VerificadorDeBanco {
  constructor(private readonly db: PrismaService) {}

  /**
   * `SELECT 1` -- a consulta mais barata que ainda prova que a conexao
   * existe e o servidor responde. Verificar so o pool diria "conectado"
   * enquanto o banco esta travado.
   */
  async verificar(): Promise<boolean> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return true;
    } catch {
      // Detalhe do erro nao sobe: readiness responde sim ou nao. O porque
      // vai para o log do filtro, com o correlationId.
      return false;
    }
  }
}
