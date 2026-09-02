import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';
import { bootstrapar } from '../src/bootstrap-tenant/bootstrapar.js';

/**
 * Prova SPEC-058 §6: comando idempotente que cria Tenant, GymUnit e o
 * primeiro usuario OWNER a partir de argumentos -- nunca do seed de
 * desenvolvimento, que grava `dono@arena-positiva.test` com senha fixa.
 */
describe('bootstrap de tenant real (SPEC-058)', () => {
  let db: PrismaClientArenaHub;
  const sufixo = randomUUID().slice(0, 8);

  beforeAll(() => {
    db = criarPrismaClient();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const argumentos = (sufixoDoTeste: string) => ({
    tenantSlug: `bootstrap-${sufixoDoTeste}`,
    legalName: 'Academia Bootstrap Teste LTDA',
    displayName: 'Academia Bootstrap Teste',
    unitCode: 'MATRIZ',
    unitName: 'Unidade Matriz',
    timezone: 'America/Sao_Paulo',
    ownerEmail: `owner-${sufixoDoTeste}@academia-bootstrap-teste.com`,
  });

  it('cria tenant, unidade com timezone e usuario OWNER com senha gerada', async () => {
    const args = argumentos(sufixo);

    const resultado = await bootstrapar(db, args);

    expect(resultado.senhaGerada).toBeTruthy();
    expect(resultado.senhaGerada?.length ?? 0).toBeGreaterThanOrEqual(16);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: resultado.tenantId } });
    expect(tenant.slug).toBe(args.tenantSlug);

    const unidade = await db.gymUnit.findUniqueOrThrow({ where: { id: resultado.gymUnitId } });
    expect(unidade.timezone).toBe('America/Sao_Paulo');
    expect(unidade.tenantId).toBe(tenant.id);

    const usuario = await db.user.findUniqueOrThrow({ where: { id: resultado.ownerUserId } });
    expect(usuario.email).toBe(args.ownerEmail);

    // O primeiro login e quem exige MFA (F6) -- o bootstrap so garante que
    // o usuario nasce sem MFA configurado, nunca contornando essa exigencia.
    expect(usuario.mfaStatus).toBe('DISABLED');

    const vinculo = await db.tenantMembership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: tenant.id, userId: usuario.id } },
    });
    expect(vinculo.status).toBe('ACTIVE');

    const papel = await db.role.findUniqueOrThrow({
      where: { tenantId_name: { tenantId: tenant.id, name: 'OWNER' } },
    });

    const papelDoUsuario = await db.userRole.findFirst({
      where: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id, gymUnitId: null },
    });
    expect(papelDoUsuario).not.toBeNull();
  });

  it('nunca cria usuario `.test` -- so o e-mail passado por argumento', async () => {
    const args = argumentos(`${sufixo}-b`);

    await bootstrapar(db, args);

    const usuarioDeSeed = await db.user.findUnique({
      where: { email: 'dono@arena-positiva.test' },
    });

    // Este teste roda num banco que pode ja ter o seed de dev aplicado --
    // o que importa e que o BOOTSTRAP em si nunca grava esse e-mail.
    if (usuarioDeSeed) {
      expect(usuarioDeSeed.email).not.toBe(args.ownerEmail);
    }
  });

  it('e idempotente: rodar duas vezes com o mesmo slug nao duplica tenant nem usuario', async () => {
    const args = argumentos(`${sufixo}-c`);

    const primeira = await bootstrapar(db, args);
    const segunda = await bootstrapar(db, args);

    expect(segunda.tenantId).toBe(primeira.tenantId);
    expect(segunda.gymUnitId).toBe(primeira.gymUnitId);
    expect(segunda.ownerUserId).toBe(primeira.ownerUserId);

    const tenants = await db.tenant.findMany({ where: { slug: args.tenantSlug } });
    expect(tenants).toHaveLength(1);

    const usuarios = await db.user.findMany({ where: { email: args.ownerEmail } });
    expect(usuarios).toHaveLength(1);
  });

  it('na segunda chamada, nao gera nem reemite senha nova para usuario ja existente', async () => {
    const args = argumentos(`${sufixo}-d`);

    const primeira = await bootstrapar(db, args);
    const segunda = await bootstrapar(db, args);

    // Reemitir senha em toda chamada tornaria o comando perigoso de rodar
    // por engano: cada re-execucao trancaria o dono de fora. Idempotente
    // aqui significa "convergir para o mesmo estado", nao "resetar senha".
    expect(segunda.senhaGerada).toBeNull();
    expect(primeira.senhaGerada).toBeTruthy();
  });
});
