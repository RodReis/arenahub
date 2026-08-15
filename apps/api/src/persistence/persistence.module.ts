import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Global porque o client de banco e infraestrutura, nao dominio: obrigar
 * cada modulo a importar `PersistenceModule` seria cerimonia sem ganho.
 *
 * Isso NAO afrouxa a regra de arquitetura no 9 -- modulo continua proibido
 * de ler tabela privada de outro. O que fica disponivel e a conexao; o que
 * cada modulo pode tocar segue sendo decisao de desenho.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}
