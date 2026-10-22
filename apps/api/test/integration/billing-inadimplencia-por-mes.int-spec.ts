import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Cobranca por mes -- abas "Inadimplentes mês atual" e "Inadimplentes Mes
 * Anterior" (decisao do PI, 19/10/2026, issue #647).
 *
 * O corte e o MES DO VENCIMENTO no fuso da unidade. Contra banco de verdade
 * (`docs/TESTING.md` 3): o filtro por aluno cobravel, a RLS de `students` e o
 * agrupamento por aluno sao comportamento real do Prisma e do Postgres.
 */
describe('Inadimplencia por mes', () => {
  let db: PrismaService;
  let consultar: ConsultarInadimplenciaUseCase;

  // 19/10/2026 12:00 em Sao Paulo: o mes corrente e outubro.
  const AGORA = new Date('2026-10-19T15:00:00.000Z');
  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let numero = 0;

  async function tenantComUnidade(slug: string): Promise<{ tenantId: string; unidadeId: string; planoId: string }> {
    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
      select: { id: true },
    });
    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
      select: { id: true },
    });
    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano ${slug}` },
      select: { id: true },
    });

    return { tenantId: tenant.id, unidadeId: unidade.id, planoId: plano.id };
  }

  /** Aluno + assinatura + uma fatura por vencimento (todas em aberto). */
  async function alunoComFaturas(opcoes: {
    tenantId: string;
    unidadeId: string;
    planoId: string;
    nome: string;
    vencimentos: string[];
    status?: 'ACTIVE' | 'BLOCKED';
  }): Promise<string> {
    const aluno = await db.student.create({
      data: {
        tenantId: opcoes.tenantId,
        gymUnitId: opcoes.unidadeId,
        membershipNumber: `${opcoes.nome}-${randomUUID().slice(0, 6)}`,
        fullName: opcoes.nome,
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: opcoes.status ?? 'ACTIVE',
      },
      select: { id: true },
    });
    const assinatura = await db.subscription.create({
      data: {
        tenantId: opcoes.tenantId,
        studentId: aluno.id,
        planId: opcoes.planoId,
        status: 'PAST_DUE',
        startsAt: new Date('2026-06-01T00:00:00Z'),
      },
      select: { id: true },
    });

    for (const vencimento of opcoes.vencimentos) {
      const dueAt = new Date(vencimento);
      numero += 1;
      await db.invoice.create({
        data: {
          tenantId: opcoes.tenantId,
          subscriptionId: assinatura.id,
          studentId: aluno.id,
          billingPeriod: new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), 1)),
          number: numero,
          status: 'OPEN',
          currency: 'BRL',
          subtotalMinor: 15000,
          totalMinor: 15000,
          dueAt,
        },
      });
    }

    return aluno.id;
  }

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    consultar = comContextoDeTenant(moduleRef.get(ConsultarInadimplenciaUseCase));

    const base = await tenantComUnidade(`mes-${sufixo}`);
    contexto.tenantId = base.tenantId;

    const novo = (nome: string, vencimentos: string[], status?: 'ACTIVE' | 'BLOCKED') =>
      alunoComFaturas({ ...base, nome, vencimentos, ...(status ? { status } : {}) });

    ids['apenasAtual'] = await novo('Apenas Atual', ['2026-10-05T15:00:00.000Z']);
    ids['apenasAnterior'] = await novo('Apenas Anterior', ['2026-09-10T15:00:00.000Z']);
    ids['nasDuas'] = await novo('Nas Duas', ['2026-10-06T15:00:00.000Z', '2026-08-10T15:00:00.000Z']);
    // 01/10 02:00Z = 30/09 23:00 em Sao Paulo: ainda setembro, mes anterior.
    ids['fronteira'] = await novo('Fronteira Setembro', ['2026-10-01T02:00:00.000Z']);
    // A vencer (25/10): nao e inadimplente em aba nenhuma.
    ids['aVencer'] = await novo('A Vencer', ['2026-10-25T15:00:00.000Z']);
    // Bloqueado: fora de Ativo + Aluno, como na fila do mes atual.
    ids['bloqueado'] = await novo('Bloqueado Antigo', ['2026-08-10T15:00:00.000Z'], 'BLOCKED');
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  it('Mes Atual (periodo ATUAL): so faturas que venceram em outubro, de aluno Ativo + Aluno', async () => {
    const painel = await consultar.executar(contexto, AGORA, { periodo: 'ATUAL' });

    expect(painel.linhas.map((l) => l.studentName).sort()).toEqual(['Apenas Atual', 'Nas Duas']);
  });

  it('sem periodo a lista continua com TODAS as faturas vencidas (comportamento anterior)', async () => {
    const painel = await consultar.executar(contexto, AGORA);

    // Apenas Atual 1 + Apenas Anterior 1 + Nas Duas 2 + Fronteira 1.
    expect(painel.linhas).toHaveLength(5);
  });

  it('os contadores das abas contam ALUNO distinto; quem deve nos dois meses conta nas duas', async () => {
    const { resumo } = await consultar.executar(contexto, AGORA, { periodo: 'ATUAL' });

    expect(resumo.alunosInadimplentesMesAtual).toBe(2); // Apenas Atual, Nas Duas
    expect(resumo.alunosInadimplentesMesesAnteriores).toBe(3); // Apenas Anterior, Nas Duas, Fronteira
    expect(resumo.alunosInadimplentes).toBe(4);
    expect(resumo.faturasVencidas).toBe(5); // os cartoes do topo seguem sobre o total
  });

  it('Mes Anterior: uma linha por aluno, com os meses em aberto', async () => {
    const painel = await consultar.executarMesesAnteriores(contexto, AGORA);

    expect(painel.total).toBe(3);

    const porNome = new Map(painel.linhas.map((l) => [l.studentName, l]));
    expect([...porNome.keys()].sort()).toEqual(['Apenas Anterior', 'Fronteira Setembro', 'Nas Duas']);
    expect(porNome.get('Apenas Anterior')).toMatchObject({ mesesEmAberto: ['2026-09'], faturas: 1 });
    expect(porNome.get('Fronteira Setembro')).toMatchObject({ mesesEmAberto: ['2026-09'], faturas: 1 });
    // So a fatura de agosto: a de outubro pertence a outra aba.
    expect(porNome.get('Nas Duas')).toMatchObject({ mesesEmAberto: ['2026-08'], faturas: 1 });
  });

  it('Mes Anterior: busca por nome, livre de acento e caixa', async () => {
    const painel = await consultar.executarMesesAnteriores(contexto, AGORA, { busca: 'fronteira' });

    expect(painel.linhas.map((l) => l.studentName)).toEqual(['Fronteira Setembro']);
    expect(painel.total).toBe(1);
  });

  it('Mes Anterior: pagina 10 em 10 por cursor de aluno, e nao ve aluno de outro tenant', async () => {
    const outro = await tenantComUnidade(`mes-pag-${sufixo}`);

    try {
      for (let i = 0; i < 12; i += 1) {
        await alunoComFaturas({
          ...outro,
          nome: `Aluno Paginacao ${String(i).padStart(2, '0')}`,
          vencimentos: ['2026-09-10T15:00:00.000Z'],
        });
      }
      const contextoDoOutro = { ...contexto, tenantId: outro.tenantId };

      const primeira = await consultar.executarMesesAnteriores(contextoDoOutro, AGORA);
      expect(primeira.linhas).toHaveLength(10);
      expect(primeira.total).toBe(12);
      expect(primeira.proximoCursor).not.toBeNull();

      const segunda = await consultar.executarMesesAnteriores(contextoDoOutro, AGORA, {
        cursor: primeira.proximoCursor!,
      });
      expect(segunda.linhas).toHaveLength(2);
      expect(segunda.proximoCursor).toBeNull();

      const vistos = new Set(primeira.linhas.map((l) => l.studentId));
      expect(segunda.linhas.every((l) => !vistos.has(l.studentId))).toBe(true);

      // INV-006: o tenant original continua com os seus 3, sem os 12 do vizinho.
      expect((await consultar.executarMesesAnteriores(contexto, AGORA)).total).toBe(3);
    } finally {
      await db.tenant.delete({ where: { id: outro.tenantId } });
    }
  });
});
