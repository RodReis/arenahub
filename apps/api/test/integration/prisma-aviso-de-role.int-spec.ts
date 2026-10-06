import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';

import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #584 -- em producao, a API avisa na subida se o role da conexao ignora o RLS.
 * Contra o Postgres de verdade: o que importa e a consulta a `pg_roles` e o
 * log, nao um duble do banco.
 */
describe('aviso de role que ignora o RLS (#584)', () => {
  const ambienteOriginal = process.env['NODE_ENV'];
  let db: PrismaService;

  beforeAll(() => {
    db = new PrismaService();
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = ambienteOriginal;
    await db.onModuleDestroy();
  });

  const roleIgnoraRls = async (): Promise<boolean> => {
    const [role] = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user
    `;

    return Boolean(role?.rolsuper || role?.rolbypassrls);
  };

  it('em producao, loga erro se (e so se) o role da conexao ignora o RLS', async () => {
    process.env['NODE_ENV'] = 'production';
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await db.onModuleInit();

    const esperado = await roleIgnoraRls();
    const avisou = erro.mock.calls.some((chamada) => String(chamada[0]).includes('RLS DESLIGADO'));
    erro.mockRestore();

    expect(avisou).toBe(esperado);
  });

  it('fora de producao nao consulta nem avisa', async () => {
    process.env['NODE_ENV'] = 'test';
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await db.onModuleInit();

    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});
