import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { planejarImportacao } from '../../src/scripts/import-pagamentos-set2026/importar.js';
import type { LinhaDeRelatorio } from '../../src/scripts/import-pagamentos-set2026/dominio.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Integracao do dry-run de importacao de pagamentos (issue #386) contra
 * Postgres de verdade -- o que o unitario de `dominio.ts` nao prova:
 * `Student` tem RLS ativa (F66), e `planejarImportacao` so enxerga linha
 * dentro de `comContexto` -- sem isso o role restrito devolve ZERO alunos
 * em silencio, e TUDO vira `NAO_ENCONTRADO` (foi o defeito real da primeira
 * rodada desta fatia contra o banco de producao: 221 pessoas cadastradas
 * classificadas como inexistentes).
 *
 * NUNCA GRAVA -- so le. `gravarPagamentosProntos` (funcao pura com
 * `registrar` injetado) fica coberta a parte, sem banco.
 *
 * Nenhum dado real de aluno (`CLAUDE.md`): nomes inventados, tenant proprio
 * por sufixo aleatorio.
 */
describe('planejarImportacao (dry-run, issue #386)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const sufixo = randomUUID().slice(0, 8);
  let tenantId: string;

  const AGORA = new Date('2026-09-18T12:00:00.000Z');

  function planejar(tid: string, linhas: LinhaDeRelatorio[]) {
    return comContexto({ kind: 'system', tenantId: tid }, () => planejarImportacao(db, tid, linhas));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `pag-set-${sufixo}`,
        legalName: `Academia Pagamentos Teste ${sufixo} LTDA`,
        displayName: `Academia Pagamentos Teste ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `UNI-${sufixo}`,
        name: 'Unidade da fixture',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({ data: { tenantId, name: `Plano ${sufixo}` } });

    await db.planPrice.create({
      data: { tenantId, planId: plano.id, amountMinor: 15_000, validFrom: new Date('2026-01-01T00:00:00Z') },
    });

    async function criarAlunoComInvoice(
      nome: string,
      opcoes: { status?: 'OPEN' | 'OVERDUE'; semInvoice?: boolean } = {},
    ): Promise<string> {
      const aluno = await comContexto({ kind: 'system', tenantId }, () =>
        db.comTenant((tx) =>
          tx.student.create({
            data: {
              tenantId,
              gymUnitId: unidade.id,
              fullName: nome,
              membershipNumber: `M-${sufixo}-${randomUUID().slice(0, 6)}`,
              birthDate: new Date('1990-01-01T00:00:00Z'),
              status: 'ACTIVE',
            },
          }),
        ),
      );

      const assinatura = await db.subscription.create({
        data: { tenantId, studentId: aluno.id, planId: plano.id, status: 'ACTIVE', startsAt: AGORA },
      });

      if (!opcoes.semInvoice) {
        await db.invoice.create({
          data: {
            tenantId,
            subscriptionId: assinatura.id,
            studentId: aluno.id,
            billingPeriod: new Date('2026-09-01T00:00:00Z'),
            status: opcoes.status ?? 'OPEN',
            number: Math.floor(Math.random() * 1_000_000),
            subtotalMinor: 15_000,
            totalMinor: 15_000,
            dueAt: new Date('2026-09-10T00:00:00Z'),
          },
        });
      }

      return aluno.id;
    }

    await criarAlunoComInvoice('Fixture Com Invoice Aberta');
    await criarAlunoComInvoice('Fixture Invoice Overdue', { status: 'OVERDUE' });
    await criarAlunoComInvoice('Fixture Sem Invoice', { semInvoice: true });
    // Ambiguo: dois alunos com o MESMO nome no mesmo tenant.
    await criarAlunoComInvoice('Fixture Nome Repetido');
    await criarAlunoComInvoice('Fixture Nome Repetido');
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app.close();
  });

  it('PRONTO quando o nome bate um unico aluno com invoice OPEN', async () => {
    const linhas: LinhaDeRelatorio[] = [
      { nome: 'Fixture Com Invoice Aberta', data: '18/09/2026', valor: 150 },
    ];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.prontos).toHaveLength(1);
    expect(relatorio.prontos[0]?.amountMinor).toBe(15_000);
    expect(relatorio.ambiguos).toHaveLength(0);
    expect(relatorio.naoEncontrados).toHaveLength(0);
  });

  it('PRONTO tambem para invoice OVERDUE, nao so OPEN', async () => {
    const linhas: LinhaDeRelatorio[] = [
      { nome: 'Fixture Invoice Overdue', data: '18/09/2026', valor: 150 },
    ];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.prontos).toHaveLength(1);
  });

  it('SEM_INVOICE_ABERTA quando o aluno existe mas nao tem cobranca pendente', async () => {
    const linhas: LinhaDeRelatorio[] = [{ nome: 'Fixture Sem Invoice', data: '18/09/2026', valor: 150 }];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.semInvoiceAberta).toHaveLength(1);
    expect(relatorio.prontos).toHaveLength(0);
  });

  it('NAO_ENCONTRADO quando nenhum aluno do tenant tem esse nome', async () => {
    const linhas: LinhaDeRelatorio[] = [
      { nome: 'Pessoa Que Nao Existe No Tenant', data: '18/09/2026', valor: 150 },
    ];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.naoEncontrados).toHaveLength(1);
  });

  it('AMBIGUO quando dois alunos do tenant tem o mesmo nome', async () => {
    const linhas: LinhaDeRelatorio[] = [{ nome: 'Fixture Nome Repetido', data: '18/09/2026', valor: 150 }];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.ambiguos).toHaveLength(1);
    expect(relatorio.prontos).toHaveLength(0);
  });

  it('DUPLICADO_NO_ARQUIVO quando o mesmo nome aparece 2x no relatorio, ANTES de consultar o banco', async () => {
    const linhas: LinhaDeRelatorio[] = [
      { nome: 'Fixture Com Invoice Aberta', data: '18/09/2026', valor: 150 },
      { nome: 'fixture com invoice aberta', data: '18/09/2026', valor: 150 },
    ];

    const relatorio = await planejar(tenantId, linhas);

    expect(relatorio.duplicadosNoArquivo).toEqual([
      { nome: 'Fixture Com Invoice Aberta', ocorrencias: 2 },
    ]);
    // Nao decide nada sobre a pessoa real -- fica so como pendencia.
    expect(relatorio.prontos).toHaveLength(0);
  });

  it('nao vaza aluno de outro tenant', async () => {
    const outroTenant = await db.tenant.create({
      data: {
        slug: `outro-${sufixo}`,
        legalName: 'Outro Tenant LTDA',
        displayName: 'Outro Tenant',
      },
    });

    try {
      const linhas: LinhaDeRelatorio[] = [
        { nome: 'Fixture Com Invoice Aberta', data: '18/09/2026', valor: 150 },
      ];

      const relatorio = await planejar(outroTenant.id, linhas);

      expect(relatorio.naoEncontrados).toHaveLength(1);
      expect(relatorio.prontos).toHaveLength(0);
    } finally {
      await db.tenant.delete({ where: { id: outroTenant.id } }).catch(() => undefined);
    }
  });
});
