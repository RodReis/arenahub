import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { MobileAvisosService } from './mobile-avisos.service.js';

const AGORA = new Date('2026-09-14T12:00:00.000Z');

const ctx: StudentChannelContext = {
  tenantId: 'tenant-1',
  studentId: 'aluno-1',
  accountId: 'conta-1',
  sessionId: 'sessao-1',
  reauthenticatedAt: null,
};

function linha(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'aviso-1',
    kind: 'BILLING',
    title: 'Fatura em aberto',
    body: 'Voce tem uma fatura aguardando pagamento.',
    action: 'OPEN_INVOICE',
    actionTargetId: 'a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b',
    readAt: null,
    expiresAt: null,
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    ...over,
  };
}

function criarDb() {
  return {
    studentNotification: {
      findMany: jest.fn<() => Promise<unknown[]>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<{ count: number }>>(),
    },
  };
}

describe('MobileAvisosService', () => {
  describe('listar', () => {
    it('devolve a caixa do aluno da sessao com a rota ja resolvida', async () => {
      const db = criarDb();
      db.studentNotification.findMany.mockResolvedValue([linha()]);

      const service = new MobileAvisosService(db as unknown as PrismaService);
      const r = await service.listar(ctx, AGORA);

      expect(r.avisos).toHaveLength(1);
      expect(r.avisos[0]).toMatchObject({
        id: 'aviso-1',
        tipo: 'BILLING',
        rota: '/financeiro?invoice=a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b',
        lido: false,
      });
    });

    /**
     * A amarra central deste canal: o aluno sai da SESSAO.
     *
     * Sem `studentId` no `where`, qualquer sessao valida leria a caixa de
     * qualquer aluno do mesmo tenant trocando nada -- bastaria existir.
     */
    it('filtra por tenant E aluno da sessao', async () => {
      const db = criarDb();
      db.studentNotification.findMany.mockResolvedValue([]);

      await new MobileAvisosService(db as unknown as PrismaService).listar(ctx, AGORA);

      const where = (db.studentNotification.findMany.mock.calls[0] as never as [{ where: Record<string, unknown> }])[0].where;
      expect(where).toMatchObject({ tenantId: 'tenant-1', studentId: 'aluno-1' });
    });

    // Expirado some da TELA. O filtro e do BANCO, nao do JavaScript: filtrar
    // depois de trazer 50 linhas devolveria menos de 50 sem avisar.
    it('pede ao banco apenas os nao expirados', async () => {
      const db = criarDb();
      db.studentNotification.findMany.mockResolvedValue([]);

      await new MobileAvisosService(db as unknown as PrismaService).listar(ctx, AGORA);

      const where = (db.studentNotification.findMany.mock.calls[0] as never as [{ where: { OR: unknown[] } }])[0].where;
      expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: AGORA } }]);
    });

    it('conta apenas os nao lidos', async () => {
      const db = criarDb();
      db.studentNotification.findMany.mockResolvedValue([
        linha({ id: 'a', readAt: null }),
        linha({ id: 'b', readAt: new Date('2026-09-14T11:00:00.000Z') }),
        linha({ id: 'c', readAt: null }),
      ]);

      const r = await new MobileAvisosService(db as unknown as PrismaService).listar(ctx, AGORA);

      expect(r.naoLidos).toBe(2);
    });

    it('pede os mais novos primeiro', async () => {
      const db = criarDb();
      db.studentNotification.findMany.mockResolvedValue([]);

      await new MobileAvisosService(db as unknown as PrismaService).listar(ctx, AGORA);

      // Sem `orderBy`, a ordem e a FISICA do Postgres, que muda depois de um
      // UPDATE -- e marcar um aviso como lido reordenaria a caixa inteira.
      const args = (db.studentNotification.findMany.mock.calls[0] as never as [{ orderBy: unknown }])[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('marcarComoLido', () => {
    it('marca e devolve o aviso', async () => {
      const db = criarDb();
      db.studentNotification.updateMany.mockResolvedValue({ count: 1 });
      db.studentNotification.findFirst.mockResolvedValue(linha({ readAt: AGORA }));

      const r = await new MobileAvisosService(db as unknown as PrismaService).marcarComoLido(
        ctx,
        'aviso-1',
        AGORA,
      );

      expect(r.lido).toBe(true);
    });

    /**
     * A posse e conferida NO BANCO, dentro do `where` do `updateMany`.
     *
     * Um `findUnique` seguido de `if (linha.studentId !== ctx.studentId)`
     * teria janela entre a leitura e a escrita -- e o `where` fecha isso por
     * construcao, sem depender de ordem de instrucao.
     */
    it('so escreve em aviso do proprio aluno', async () => {
      const db = criarDb();
      db.studentNotification.updateMany.mockResolvedValue({ count: 0 });
      db.studentNotification.findFirst.mockResolvedValue(linha());

      await new MobileAvisosService(db as unknown as PrismaService).marcarComoLido(
        ctx,
        'aviso-1',
        AGORA,
      );

      const where = (db.studentNotification.updateMany.mock.calls[0] as never as [{ where: Record<string, unknown> }])[0].where;
      expect(where).toMatchObject({
        id: 'aviso-1',
        tenantId: 'tenant-1',
        studentId: 'aluno-1',
      });
    });

    // Idempotente: `readAt: null` no `where` impede a segunda marcacao de
    // mover o instante e apagar quando o aviso foi visto de fato.
    it('nao move o instante de leitura na segunda vez', async () => {
      const db = criarDb();
      db.studentNotification.updateMany.mockResolvedValue({ count: 0 });
      db.studentNotification.findFirst.mockResolvedValue(
        linha({ readAt: new Date('2026-09-14T09:00:00.000Z') }),
      );

      const service = new MobileAvisosService(db as unknown as PrismaService);
      const r = await service.marcarComoLido(ctx, 'aviso-1', AGORA);

      const where = (db.studentNotification.updateMany.mock.calls[0] as never as [{ where: Record<string, unknown> }])[0].where;
      expect(where).toMatchObject({ readAt: null });
      expect(r.lido).toBe(true);
    });

    // 404, nunca 403: "existe, mas nao e seu" confirma a existencia do
    // recurso para quem esta sondando ids.
    it('responde 404 para aviso de outro aluno', async () => {
      const db = criarDb();
      db.studentNotification.updateMany.mockResolvedValue({ count: 0 });
      db.studentNotification.findFirst.mockResolvedValue(null);

      const service = new MobileAvisosService(db as unknown as PrismaService);

      await expect(service.marcarComoLido(ctx, 'aviso-de-outro', AGORA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
