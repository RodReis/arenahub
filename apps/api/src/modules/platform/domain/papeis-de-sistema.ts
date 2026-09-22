import { PAPEIS_DE_SISTEMA } from '@arenahub/database';
import type { Prisma } from '@arenahub/database';

/**
 * Cria (ou repoe) os cinco papeis de sistema de um tenant -- F80.
 *
 * EXISTE COMO FUNCAO E NAO INLINE no `CriarTenantUseCase` porque tem DOIS
 * chamadores desde o primeiro dia: o tenant novo e o backfill dos que ja
 * existem. Duas copias da mesma montagem e como o `bootstrap-tenant` nasceu
 * com sete permissoes a menos que o seed -- a divergencia so aparece em
 * producao, e la ela custa caro.
 *
 * IDEMPOTENTE POR CONSTRUCAO, nos tres niveis:
 *
 * - `Role` por `upsert` em `(tenantId, name)`, a `@@unique` do schema;
 * - `Permission` por `upsert` no `code`, porque o catalogo e GLOBAL e pode
 *   nao ter o codigo ainda;
 * - `RolePermission` por `createMany({ skipDuplicates })`, para reexecutar
 *   nunca lancar em papel que ja tem o vinculo.
 *
 * Reexecutar e seguro e nao mexe em `UserRole`: ninguem muda de perfil por
 * causa de uma migration.
 */
export async function garantirPapeisDeSistema(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<Map<string, string>> {
  const porNome = new Map<string, string>();

  for (const papel of PAPEIS_DE_SISTEMA) {
    const criado = await tx.role.upsert({
      where: { tenantId_name: { tenantId, name: papel.name } },
      create: { tenantId, name: papel.name, isSystem: true },
      // `isSystem: true` tambem no update: um papel que alguem tenha criado a
      // mao com o mesmo nome passa a ser de sistema, e a tela para de oferecer
      // edicao sobre algo que o backfill sobrescreve.
      update: { isSystem: true },
    });

    const permissoes = [];

    for (const code of papel.permissoes) {
      permissoes.push(await tx.permission.upsert({ where: { code }, create: { code }, update: {} }));
    }

    await tx.rolePermission.createMany({
      data: permissoes.map((permissao) => ({ roleId: criado.id, permissionId: permissao.id })),
      skipDuplicates: true,
    });

    porNome.set(papel.name, criado.id);
  }

  return porNome;
}
