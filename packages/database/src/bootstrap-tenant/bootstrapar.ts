import { randomBytes } from 'node:crypto';

import type { PrismaClientArenaHub } from '../client.js';
import { gerarHash } from '../senha.js';

export interface ArgumentosDeBootstrap {
  tenantSlug: string;
  legalName: string;
  displayName: string;
  unitCode: string;
  unitName: string;
  /** IANA (`America/Sao_Paulo`). Sem fallback -- mesma regra do `GymUnit` (ADR-019). */
  timezone: string;
  ownerEmail: string;
}

export interface ResultadoDoBootstrap {
  tenantId: string;
  gymUnitId: string;
  ownerUserId: string;
  /**
   * `null` quando o usuario OWNER ja existia (chamada repetida). Reemitir
   * senha em toda execucao tornaria o comando perigoso de rodar por
   * engano -- idempotente aqui significa convergir para o mesmo estado, nao
   * resetar credencial de quem ja tem conta.
   */
  senhaGerada: string | null;
}

const PERMISSOES_DO_OWNER = [
  'tenant.read',
  'tenant.update',
  'unit.create',
  'unit.read',
  'unit.update',
  'user.manage',
  'role.assign',
];

/**
 * Bootstrap de tenant real -- SPEC-058 §6.
 *
 * Distinto do `seed.ts` de proposito: aquele semeia dado FALSO de
 * desenvolvimento (`dono@arena-positiva.test`, senha fixa); este cria o
 * PRIMEIRO tenant real de producao a partir de argumentos, com senha gerada
 * e exibida uma vez. Nenhum dos dois reaproveita o outro.
 *
 * IDEMPOTENTE por `tenantSlug` e `ownerEmail`: rodar duas vezes com os
 * mesmos argumentos converge para o mesmo tenant/unidade/usuario, sem
 * duplicar nem reemitir senha.
 */
export async function bootstrapar(
  db: PrismaClientArenaHub,
  args: ArgumentosDeBootstrap,
): Promise<ResultadoDoBootstrap> {
  const tenant = await db.tenant.upsert({
    where: { slug: args.tenantSlug },
    create: {
      slug: args.tenantSlug,
      legalName: args.legalName,
      displayName: args.displayName,
    },
    update: {},
  });

  const unidade = await db.gymUnit.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: args.unitCode } },
    create: {
      tenantId: tenant.id,
      code: args.unitCode,
      name: args.unitName,
      timezone: args.timezone,
      openingHours: {},
    },
    update: {},
  });

  const usuarioExistente = await db.user.findUnique({ where: { email: args.ownerEmail } });

  const senhaGerada = usuarioExistente ? null : randomBytes(18).toString('base64url');

  const usuario = usuarioExistente
    ? usuarioExistente
    : await db.user.create({
        data: {
          email: args.ownerEmail,
          // `senhaGerada` so e null quando `usuarioExistente` existe -- este
          // ramo so roda quando ele nao existe.
          passwordHash: await gerarHash(senhaGerada as string),
        },
      });

  await db.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: usuario.id } },
    create: { tenantId: tenant.id, userId: usuario.id },
    update: { status: 'ACTIVE' },
  });

  const papel = await db.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'OWNER' } },
    create: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
    update: {},
  });

  for (const code of PERMISSOES_DO_OWNER) {
    const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });

    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: papel.id, permissionId: permissao.id } },
      create: { roleId: papel.id, permissionId: permissao.id },
      update: {},
    });
  }

  const jaTemPapel = await db.userRole.findFirst({
    where: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id, gymUnitId: null },
  });

  if (!jaTemPapel) {
    await db.userRole.create({
      data: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id },
    });
  }

  return {
    tenantId: tenant.id,
    gymUnitId: unidade.id,
    ownerUserId: usuario.id,
    senhaGerada,
  };
}
