/**
 * Seed de desenvolvimento local.
 *
 * O CLAUDE.md e categorico: "sem hardcode e sem dado inventado no caminho de
 * producao; dado local de desenvolvimento entra por seed, criado na primeira
 * fatia que precisar". A F6 e essa fatia -- o E2E precisa de um proprietario
 * que consiga entrar.
 *
 *   pnpm --filter @arenahub/database seed
 *
 * REGRA QUE NAO SE NEGOCIA: nunca versionar dado real de aluno aqui. Nem em
 * fixture, nem em golden file, nem em log de erro. O dado abaixo e
 * obviamente falso -- dominio `.test`, reservado pela RFC 2606 justamente
 * para nao existir de verdade.
 *
 * IDEMPOTENTE: roda quantas vezes for preciso sem duplicar. Seed que so
 * funciona em banco vazio obriga a derrubar tudo antes de cada execucao.
 */
import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega sozinho; `tsx`, nao.
//
// ORDEM IMPORTA: antes do import que abre o client.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';

// `promisify(scrypt)` perde a sobrecarga que aceita `ScryptOptions`. O
// wrapper manual preserva os quatro argumentos com tipo -- mesmo motivo do
// `PasswordService` da API.
function derivar(
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha, sal, tamanho, opcoes, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

const TENANT = { slug: 'arena-positiva', legalName: 'Complexo Arena Positiva LTDA', displayName: 'Arena Positiva' };
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const UNIDADE = { code: 'MATRIZ', name: 'Unidade Matriz', timezone: 'America/Sao_Paulo' };

/**
 * Mesmo envelope do `PasswordService` da API.
 *
 * Duplicado de proposito: o pacote de banco nao depende da API, e inverter
 * essa dependencia para reaproveitar uma funcao de 15 linhas custaria mais
 * do que resolve. Se um terceiro lugar precisar, extrai para
 * `packages/testing`.
 */
async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(senha, sal, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  return `scrypt$v=1$N=16384$r=8$p=1$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

const PERMISSOES = [
  'tenant.read',
  'tenant.update',
  'unit.create',
  'unit.read',
  'unit.update',
  'user.manage',
  'role.assign',
];

async function semear(): Promise<void> {
  const db = criarPrismaClient();

  try {
    const tenant = await db.tenant.upsert({
      where: { slug: TENANT.slug },
      create: TENANT,
      update: {},
    });

    const usuario = await db.user.upsert({
      where: { email: DONO.email },
      create: { email: DONO.email, passwordHash: await gerarHash(DONO.senha) },
      update: {},
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

    for (const code of PERMISSOES) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

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

    await db.gymUnit.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: UNIDADE.code } },
      create: { ...UNIDADE, tenantId: tenant.id, openingHours: {} },
      update: {},
    });

    console.info(`[seed] tenant "${TENANT.slug}" pronto, com dono ${DONO.email}.`);
  } finally {
    // Sem `$disconnect` o pool segura o processo de pe -- o `client.ts`
    // avisa disso explicitamente.
    await db.$disconnect();
  }
}

try {
  await semear();
} catch (erro: unknown) {
  console.error('[seed] falhou:', erro);
  process.exitCode = 1;
}
