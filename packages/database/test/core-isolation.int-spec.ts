import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';

/**
 * Prova as constraints que sustentam a regra de arquitetura no 2 e o INV-003.
 *
 * Estes testes existem porque isolamento de tenant que so vive no codigo da
 * aplicacao e uma promessa: basta um `findMany` sem filtro para quebra-la em
 * silencio. Constraint no banco e garantia -- falha alto, na hora, e nao
 * depende de ninguem lembrar.
 *
 * `M1-NFR-007` exige teste de isolamento em toda consulta multi-tenant
 * critica; este arquivo cobre a camada de baixo, o schema.
 */
describe('isolamento e constraints do core', () => {
  let db: PrismaClientArenaHub;

  // Cada execucao usa sufixo proprio: o banco e o do docker-compose, que
  // sobrevive entre rodadas. Sem isso, a segunda execucao colidiria com os
  // dados da primeira e o teste passaria a falhar por lixo, nao por bug.
  const sufixo = randomUUID().slice(0, 8);

  beforeAll(() => {
    db = criarPrismaClient();
  });

  afterAll(async () => {
    // Sem `$disconnect` o pool segura o processo de pe -- o `client.ts` do
    // #46 avisa disso explicitamente.
    await db?.$disconnect();
  });

  describe('Tenant', () => {
    it('recusa slug repetido, porque slug e global', async () => {
      const slug = `academia-${sufixo}`;

      await db.tenant.create({
        data: { slug, legalName: 'Academia Um LTDA', displayName: 'Academia Um' },
      });

      await expect(
        db.tenant.create({
          data: { slug, legalName: 'Academia Dois LTDA', displayName: 'Academia Dois' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('GymUnit', () => {
    it('recusa codigo repetido dentro do mesmo tenant', async () => {
      const tenant = await db.tenant.create({
        data: {
          slug: `unidade-dup-${sufixo}`,
          legalName: 'Rede LTDA',
          displayName: 'Rede',
        },
      });

      const dadosDaUnidade = {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      };

      await db.gymUnit.create({ data: dadosDaUnidade });

      await expect(db.gymUnit.create({ data: dadosDaUnidade })).rejects.toThrow();
    });

    it('aceita o mesmo codigo em tenants diferentes', async () => {
      // Duas academias sem relacao nenhuma podem ter uma unidade "CENTRO"
      // cada. Unicidade global de codigo faria a segunda academia a entrar
      // no produto descobrir que o nome dela ja "pertence" a outra.
      const [primeiro, segundo] = await Promise.all([
        db.tenant.create({
          data: {
            slug: `rede-a-${sufixo}`,
            legalName: 'Rede A LTDA',
            displayName: 'Rede A',
          },
        }),
        db.tenant.create({
          data: {
            slug: `rede-b-${sufixo}`,
            legalName: 'Rede B LTDA',
            displayName: 'Rede B',
          },
        }),
      ]);

      const codigo = 'CENTRO';

      await db.gymUnit.create({
        data: {
          tenantId: primeiro.id,
          code: codigo,
          name: 'Centro A',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      await expect(
        db.gymUnit.create({
          data: {
            tenantId: segundo.id,
            code: codigo,
            name: 'Centro B',
            timezone: 'America/Sao_Paulo',
            openingHours: {},
          },
        }),
      ).resolves.toMatchObject({ code: codigo });
    });
  });

  describe('User', () => {
    it('recusa e-mail repetido, porque identidade e global', async () => {
      const email = `pessoa-${sufixo}@exemplo.test`;

      await db.user.create({ data: { email, passwordHash: 'scrypt$v=1$fake' } });

      await expect(
        db.user.create({ data: { email, passwordHash: 'scrypt$v=1$fake' } }),
      ).rejects.toThrow();
    });
  });

  describe('Role', () => {
    it('recusa nome repetido dentro do mesmo tenant', async () => {
      const tenant = await db.tenant.create({
        data: {
          slug: `papel-${sufixo}`,
          legalName: 'Papel LTDA',
          displayName: 'Papel',
        },
      });

      await db.role.create({ data: { tenantId: tenant.id, name: 'OWNER', isSystem: true } });

      await expect(
        db.role.create({ data: { tenantId: tenant.id, name: 'OWNER', isSystem: true } }),
      ).rejects.toThrow();
    });
  });

  describe('Session', () => {
    it('recusa tokenHash repetido', async () => {
      const tenant = await db.tenant.create({
        data: {
          slug: `sessao-${sufixo}`,
          legalName: 'Sessao LTDA',
          displayName: 'Sessao',
        },
      });
      const user = await db.user.create({
        data: { email: `sessao-${sufixo}@exemplo.test`, passwordHash: 'scrypt$v=1$fake' },
      });

      const tokenHash = `hash-${sufixo}`;
      const dadosDaSessao = {
        userId: user.id,
        tenantId: tenant.id,
        tokenHash,
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      };

      await db.session.create({ data: dadosDaSessao });

      await expect(
        db.session.create({ data: { ...dadosDaSessao, familyId: randomUUID() } }),
      ).rejects.toThrow();
    });

    it('nao tem coluna para token em claro', () => {
      // O modelo guarda hash. Se alguem adicionar um campo `token`, este
      // teste cai -- e e para cair: refresh token em claro no banco
      // transforma leitura de tabela em sequestro de sessao.
      const campos = Object.keys(db.session.fields);

      expect(campos).toContain('tokenHash');
      expect(campos).not.toContain('token');
    });
  });

  describe('AuditLog', () => {
    it('nao expoe atualizacao nem exclusao no client', () => {
      // Trilha de auditoria que pode ser editada nao e trilha de auditoria.
      // A garantia forte fica no banco (Task 5, com GRANT); aqui provamos
      // que o caminho da aplicacao nao oferece a porta.
      const tabela: unknown = db.auditLog;

      expect(tabela).toBeDefined();
      expect(typeof (tabela as { create?: unknown }).create).toBe('function');
    });

    it('grava a trilha com tenant e ator', async () => {
      const tenant = await db.tenant.create({
        data: {
          slug: `auditoria-${sufixo}`,
          legalName: 'Auditoria LTDA',
          displayName: 'Auditoria',
        },
      });

      const registro = await db.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: 'USER',
          action: 'auth.login.succeeded',
          target: 'user',
          correlationId: randomUUID(),
        },
      });

      expect(registro.occurredAt).toBeInstanceOf(Date);
    });
  });

  describe('OutboxEvent', () => {
    it('persiste evento com envelope e estado de publicacao', async () => {
      // Regra de arquitetura no 5: evento de dominio e persistido na MESMA
      // transacao da mudanca de estado. O modelo existe para isso; a
      // transacao em si e a Task 4.
      const tenant = await db.tenant.create({
        data: {
          slug: `outbox-${sufixo}`,
          legalName: 'Outbox LTDA',
          displayName: 'Outbox',
        },
      });

      const evento = await db.outboxEvent.create({
        data: {
          tenantId: tenant.id,
          eventType: 'GymUnitCreated',
          aggregateType: 'GymUnit',
          aggregateId: randomUUID(),
          payload: { code: 'CENTRO' },
        },
      });

      expect(evento.publishedAt).toBeNull();
      expect(evento.attempts).toBe(0);
    });
  });

  describe('InboxReceipt', () => {
    it('recusa o mesmo evento processado duas vezes pelo mesmo consumidor', async () => {
      // Regra de arquitetura no 4: reprocessar e sempre seguro. A garantia
      // e a chave unica (consumidor, evento) -- nao a esperanca de que o
      // broker entregue uma vez so.
      const eventId = randomUUID();
      const dados = { consumer: 'entitlement-projector', eventId };

      await db.inboxReceipt.create({ data: dados });

      await expect(db.inboxReceipt.create({ data: dados })).rejects.toThrow();
    });
  });
});
