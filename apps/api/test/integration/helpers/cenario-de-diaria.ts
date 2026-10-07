import { randomUUID } from 'node:crypto';

import type { TenantContext } from '../../../src/common/tenant/tenant-context.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';
import type { PrismaService } from '../../../src/persistence/prisma.service.js';

/** Quarta-feira, 12:00 em America/Sao_Paulo (UTC-3). */
export const AGORA = new Date('2026-10-07T15:00:00.000Z');
/** Quinta-feira, 00:00 em America/Sao_Paulo: o fim EXCLUSIVO da diaria vendida em `AGORA`. */
export const FIM_DO_DIA = new Date('2026-10-08T03:00:00.000Z');
export const PRECO_DA_DIARIA_MINOR = 3_000;

export interface CenarioDeDiaria {
  readonly sufixo: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly unidadeId: string;
}

/** `actorId` e um usuario REAL: `audit_logs.actor_id` tem FK para `users`. */
export function contextoDe(c: CenarioDeDiaria): TenantContext {
  return {
    tenantId: c.tenantId,
    actorId: c.actorId,
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
}

export async function criarCenarioDeDiaria(
  db: PrismaService,
  senhas: PasswordService,
  opcoes: { comConfiguracaoFinanceira?: boolean } = {},
): Promise<CenarioDeDiaria> {
  const sufixo = randomUUID().slice(0, 8);

  const tenant = await db.tenant.create({
    data: {
      slug: `diaria-${sufixo}`,
      legalName: `Diaria ${sufixo} LTDA`,
      displayName: `Diaria ${sufixo}`,
    },
  });

  const operador = await db.user.create({
    data: {
      email: `diaria-op-${sufixo}@exemplo.test`,
      passwordHash: await senhas.gerarHash('diaria-senha-de-teste-nao-usada-em-producao'),
    },
    select: { id: true },
  });
  await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });

  if (opcoes.comConfiguracaoFinanceira ?? true) {
    await db.billingSettings.create({ data: { tenantId: tenant.id, dueDay: 9, graceDays: 3 } });
  }

  const unidade = await db.gymUnit.create({
    data: {
      tenantId: tenant.id,
      code: 'MTZ',
      name: 'Matriz',
      timezone: 'America/Sao_Paulo',
      openingHours: {},
    },
  });

  return { sufixo, tenantId: tenant.id, actorId: operador.id, unidadeId: unidade.id };
}

export async function apagarCenario(db: PrismaService, c: CenarioDeDiaria): Promise<void> {
  await db.tenant.deleteMany({ where: { id: c.tenantId } });
}

/**
 * Plano com unidade, janela e preco vigente ancorado em 2026-01-01 (qualquer
 * competencia de 2026 encontra preco). Sem `diasComJanela`, abre os 7 dias,
 * 00:00-24:00 -- o teste que precisa de dia fechado diz quais dias abrem.
 */
export async function criarPlano(
  db: PrismaService,
  c: CenarioDeDiaria,
  opcoes: {
    nome?: string;
    billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA';
    ativo?: boolean;
    amountMinor?: number;
    diasComJanela?: readonly number[];
  } = {},
): Promise<string> {
  const dias = opcoes.diasComJanela ?? [0, 1, 2, 3, 4, 5, 6];

  const plano = await db.plan.create({
    data: {
      tenantId: c.tenantId,
      name: opcoes.nome ?? `Plano ${randomUUID().slice(0, 8)}`,
      billingMode: opcoes.billingMode ?? 'DIARIA',
      isActive: opcoes.ativo ?? true,
      units: { create: [{ tenantId: c.tenantId, gymUnitId: c.unidadeId }] },
      accessWindows: {
        create: dias.map((dayOfWeek) => ({
          tenantId: c.tenantId,
          gymUnitId: c.unidadeId,
          dayOfWeek,
          startMinute: 0,
          endMinute: 1440,
        })),
      },
      prices: {
        create: [
          {
            tenantId: c.tenantId,
            amountMinor: opcoes.amountMinor ?? PRECO_DA_DIARIA_MINOR,
            validFrom: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      },
    },
    select: { id: true },
  });

  return plano.id;
}

export async function criarAluno(
  db: PrismaService,
  c: CenarioDeDiaria,
  status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE',
): Promise<string> {
  const aluno = await db.student.create({
    data: {
      tenantId: c.tenantId,
      gymUnitId: c.unidadeId,
      membershipNumber: `D86-${randomUUID().slice(0, 8)}`,
      fullName: 'Aluno Diaria',
      birthDate: new Date('2000-01-01T00:00:00Z'),
      status,
    },
    select: { id: true },
  });

  return aluno.id;
}
