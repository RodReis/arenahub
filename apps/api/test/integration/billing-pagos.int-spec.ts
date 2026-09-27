import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { ConsultarPagosUseCase } from '../../src/modules/billing/consultar-pagos.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Aba "Pagantes" da tela de cobranca -- espelho de
 * `billing-inadimplencia.int-spec.ts` para o outro lado da mesma pergunta.
 *
 * UMA LINHA POR ALUNO (nao por fatura): o contador da aba precisa responder
 * "quantos alunos estao em dia", nao "quantas faturas foram pagas".
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a ordenacao, o filtro por
 * `status: 'PAID'` e o dedup por aluno sao comportamento real do Prisma e do
 * Postgres, e dublar o banco provaria so a sintaxe do TypeScript.
 */
describe('Aba Pagantes -- alunos em dia', () => {
  let db: PrismaService;
  let consultar: ConsultarPagosUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let planoId = '';
  let unidadeId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    consultar = comContextoDeTenant(moduleRef.get(ConsultarPagosUseCase));

    const tenant = await db.tenant.create({
      data: {
        slug: `pagos-${sufixo}`,
        legalName: `Pagos ${sufixo} LTDA`,
        displayName: `Pagos ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano Pagos ${sufixo}` },
      select: { id: true },
    });
    planoId = plano.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  /** Cria aluno + assinatura + invoice PAGA, pronto para aparecer na aba. */
  async function alunoComFaturaPaga(opcoes: {
    tenantId: string;
    nome: string;
    matricula: string;
    totalMinor: number;
    paidAt: Date;
    telefone?: string;
  }): Promise<{ studentId: string; invoiceId: string }> {
    const aluno = await db.student.create({
      data: {
        tenantId: opcoes.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: opcoes.matricula,
        fullName: opcoes.nome,
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
        ...(opcoes.telefone !== undefined
          ? {
              contacts: {
                create: { tenantId: opcoes.tenantId, type: 'WHATSAPP', value: opcoes.telefone },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: opcoes.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    const invoice = await db.invoice.create({
      data: {
        tenantId: opcoes.tenantId,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-08-01T00:00:00Z'),
        number: Math.floor(Math.random() * 1_000_000),
        status: 'PAID',
        currency: 'BRL',
        subtotalMinor: opcoes.totalMinor,
        totalMinor: opcoes.totalMinor,
        dueAt: new Date('2026-08-10T14:00:00.000Z'),
        paidAt: opcoes.paidAt,
      },
      select: { id: true },
    });

    return { studentId: aluno.id, invoiceId: invoice.id };
  }

  /** Tenant descartavel, para as tentativas de cruzamento (INV-006). */
  async function tenantVazio(slug: string): Promise<string> {
    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
      select: { id: true },
    });

    return tenant.id;
  }

  it('lista fatura PAGA, com telefone e fuso do aluno', async () => {
    const { invoiceId } = await alunoComFaturaPaga({
      tenantId: contexto.tenantId,
      nome: 'Marina Paga',
      matricula: `MP-${sufixo}`,
      totalMinor: 15000,
      paidAt: new Date('2026-08-11T12:00:00.000Z'),
      telefone: '41998765432',
    });

    const painel = await consultar.executar(contexto);

    const linha = painel.linhas.find((l) => l.invoiceId === invoiceId);
    expect(linha).toBeDefined();
    expect(linha?.amountMinor).toBe(15000);
    expect(linha?.telefone).toBe('41998765432');
    expect(linha?.fusoDaUnidade).toBe('America/Sao_Paulo');
    expect(linha?.paidAt.toISOString()).toBe('2026-08-11T12:00:00.000Z');
  });

  it('NAO lista fatura em aberto -- so PAID entra na aba', async () => {
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `AB-${sufixo}`,
        fullName: 'Aluno Em Aberto',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    const invoice = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-08-01T00:00:00Z'),
        number: Math.floor(Math.random() * 1_000_000),
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 9990,
        totalMinor: 9990,
        dueAt: new Date('2026-09-10T14:00:00.000Z'),
      },
      select: { id: true },
    });

    const painel = await consultar.executar(contexto);

    expect(painel.linhas.some((l) => l.invoiceId === invoice.id)).toBe(false);
  });

  it('ordena por PAGO MAIS RECENTE primeiro', async () => {
    const antiga = await alunoComFaturaPaga({
      tenantId: contexto.tenantId,
      nome: 'Pago Antigo',
      matricula: `ANT-${sufixo}`,
      totalMinor: 10000,
      paidAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    const recente = await alunoComFaturaPaga({
      tenantId: contexto.tenantId,
      nome: 'Pago Recente',
      matricula: `REC-${sufixo}`,
      totalMinor: 10000,
      paidAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    const painel = await consultar.executar(contexto);

    const indiceRecente = painel.linhas.findIndex((l) => l.invoiceId === recente.invoiceId);
    const indiceAntiga = painel.linhas.findIndex((l) => l.invoiceId === antiga.invoiceId);

    expect(indiceRecente).toBeGreaterThanOrEqual(0);
    expect(indiceAntiga).toBeGreaterThanOrEqual(0);
    expect(indiceRecente).toBeLessThan(indiceAntiga);
  });

  it('UMA LINHA POR ALUNO -- quem pagou tres faturas aparece uma vez so, com a mais recente', async () => {
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `MULTI-${sufixo}`,
        fullName: 'Aluno Multi Fatura',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date('2026-06-01T00:00:00Z'),
      },
      select: { id: true },
    });

    const criarFaturaPaga = (billingPeriod: string, paidAt: string, totalMinor: number) =>
      db.invoice.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId: assinatura.id,
          studentId: aluno.id,
          billingPeriod: new Date(billingPeriod),
          number: Math.floor(Math.random() * 1_000_000),
          status: 'PAID',
          currency: 'BRL',
          subtotalMinor: totalMinor,
          totalMinor,
          dueAt: new Date(billingPeriod),
          paidAt: new Date(paidAt),
        },
        select: { id: true },
      });

    await criarFaturaPaga('2026-06-01T00:00:00Z', '2026-06-05T10:00:00.000Z', 10000);
    await criarFaturaPaga('2026-07-01T00:00:00Z', '2026-07-05T10:00:00.000Z', 10000);
    const maisRecente = await criarFaturaPaga(
      '2026-08-01T00:00:00Z',
      '2026-08-05T10:00:00.000Z',
      12000,
    );

    const painel = await consultar.executar(contexto);

    const linhasDoAluno = painel.linhas.filter((l) => l.studentId === aluno.id);
    expect(linhasDoAluno).toHaveLength(1);
    expect(linhasDoAluno[0]?.invoiceId).toBe(maisRecente.id);
    expect(linhasDoAluno[0]?.amountMinor).toBe(12000);
    expect(linhasDoAluno[0]?.paidAt.toISOString()).toBe('2026-08-05T10:00:00.000Z');
  });

  it('sem telefone cadastrado, a linha traz null -- nao quebra', async () => {
    const { invoiceId } = await alunoComFaturaPaga({
      tenantId: contexto.tenantId,
      nome: 'Sem Telefone',
      matricula: `ST-${sufixo}`,
      totalMinor: 8000,
      paidAt: new Date('2026-08-05T10:00:00.000Z'),
    });

    const painel = await consultar.executar(contexto);
    const linha = painel.linhas.find((l) => l.invoiceId === invoiceId);

    expect(linha?.telefone).toBeNull();
  });

  it('busca por nome, livre de acento e caixa', async () => {
    const { studentId } = await alunoComFaturaPaga({
      tenantId: contexto.tenantId,
      nome: 'José da Busca Ação',
      matricula: `JB-${sufixo}`,
      totalMinor: 10000,
      paidAt: new Date('2026-08-13T10:00:00.000Z'),
    });

    const painel = await consultar.executar(contexto, { busca: 'jose da busca acao' });

    expect(painel.linhas.some((l) => l.studentId === studentId)).toBe(true);

    const semResultado = await consultar.executar(contexto, { busca: 'nome que nao existe' });

    expect(semResultado.linhas.some((l) => l.studentId === studentId)).toBe(false);
  });

  it('pagina 10 em 10, por cursor', async () => {
    const tenantComVolume = await tenantVazio(`pagos-paginacao-${sufixo}`);

    try {
      const unidade = await db.gymUnit.create({
        data: {
          tenantId: tenantComVolume,
          code: 'MTZ',
          name: 'Matriz',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const plano = await db.plan.create({
        data: { tenantId: tenantComVolume, name: `Plano Pagos Paginacao ${sufixo}` },
        select: { id: true },
      });

      // 25 alunos com fatura PAGA -- 3 paginas de 10/10/5.
      for (let indice = 0; indice < 25; indice += 1) {
        const aluno = await db.student.create({
          data: {
            tenantId: tenantComVolume,
            gymUnitId: unidade.id,
            membershipNumber: `PGP-${sufixo}-${String(indice)}`,
            fullName: `Aluno Pago Paginacao ${String(indice).padStart(2, '0')}`,
            birthDate: new Date('2000-01-01T00:00:00Z'),
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        const assinatura = await db.subscription.create({
          data: {
            tenantId: tenantComVolume,
            studentId: aluno.id,
            planId: plano.id,
            status: 'ACTIVE',
            startsAt: new Date('2026-08-01T00:00:00Z'),
          },
          select: { id: true },
        });

        await db.invoice.create({
          data: {
            tenantId: tenantComVolume,
            subscriptionId: assinatura.id,
            studentId: aluno.id,
            billingPeriod: new Date('2026-08-01T00:00:00Z'),
            number: indice + 1,
            status: 'PAID',
            currency: 'BRL',
            subtotalMinor: 10000 + indice,
            totalMinor: 10000 + indice,
            dueAt: new Date('2026-08-10T14:00:00.000Z'),
            paidAt: new Date(2026, 7, 10 + indice, 10, 0, 0),
          },
        });
      }

      const contextoDoVolume = { ...contexto, tenantId: tenantComVolume };

      const primeira = await consultar.executar(contextoDoVolume);
      expect(primeira.linhas).toHaveLength(10);
      expect(primeira.proximoCursor).not.toBeNull();
      expect(primeira.total).toBe(25);

      const segunda = await consultar.executar(contextoDoVolume, {
        cursor: primeira.proximoCursor!,
      });
      expect(segunda.linhas).toHaveLength(10);
      expect(segunda.proximoCursor).not.toBeNull();

      const idsDaPrimeira = new Set(primeira.linhas.map((l) => l.studentId));
      expect(segunda.linhas.every((l) => !idsDaPrimeira.has(l.studentId))).toBe(true);

      const terceira = await consultar.executar(contextoDoVolume, {
        cursor: segunda.proximoCursor!,
      });
      expect(terceira.linhas).toHaveLength(5);
      expect(terceira.proximoCursor).toBeNull();
    } finally {
      await db.tenant.delete({ where: { id: tenantComVolume } });
    }
  });

  it('INV-006: nao ve fatura paga de outro tenant', async () => {
    /**
     * `docs/TESTING.md` 5: todo caso de uso multi-tenant critico tem teste que
     * TENTA CRUZAR TENANTS E FALHA. Esta consulta le nome, valor e telefone --
     * vazamento aqui entrega o historico de pagamento de uma academia a outra.
     */
    const vizinho = await tenantVazio(`pagos-viz-${sufixo}`);

    try {
      const unidadeVizinha = await db.gymUnit.create({
        data: {
          tenantId: vizinho,
          code: 'MTZ',
          name: 'Matriz',
          timezone: 'America/Manaus',
          openingHours: {},
        },
      });

      const planoVizinho = await db.plan.create({
        data: { tenantId: vizinho, name: `Plano Vizinho ${sufixo}` },
        select: { id: true },
      });

      const alunoVizinho = await db.student.create({
        data: {
          tenantId: vizinho,
          gymUnitId: unidadeVizinha.id,
          membershipNumber: `VIZ-${sufixo}`,
          fullName: 'Aluno Vizinho',
          birthDate: new Date('2000-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      const assinaturaVizinha = await db.subscription.create({
        data: {
          tenantId: vizinho,
          studentId: alunoVizinho.id,
          planId: planoVizinho.id,
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
        },
        select: { id: true },
      });

      await db.invoice.create({
        data: {
          tenantId: vizinho,
          subscriptionId: assinaturaVizinha.id,
          studentId: alunoVizinho.id,
          billingPeriod: new Date('2026-08-01T00:00:00Z'),
          number: 1,
          status: 'PAID',
          currency: 'BRL',
          subtotalMinor: 5000,
          totalMinor: 5000,
          dueAt: new Date('2026-08-10T14:00:00.000Z'),
          paidAt: new Date('2026-08-11T10:00:00.000Z'),
        },
      });

      const painel = await consultar.executar({ ...contexto, tenantId: vizinho });

      expect(painel.linhas).toHaveLength(1);
      expect(painel.linhas[0]?.studentName).toBe('Aluno Vizinho');

      /** E o tenant original nao ve a fatura do vizinho. */
      const painelOriginal = await consultar.executar(contexto);
      expect(painelOriginal.linhas.some((l) => l.studentName === 'Aluno Vizinho')).toBe(false);
    } finally {
      await db.tenant.delete({ where: { id: vizinho } });
    }
  });
});
