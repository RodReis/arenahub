import type { Prisma, StudentProfile } from '@arenahub/database';

/**
 * Direito de acesso por VINCULO -- professor, personal, funcionario, admin (#662).
 *
 * O perfil NAO decide acesso (regra de arquitetura no 1): ele so diz qual
 * `EntitlementSource` origina o `Entitlement`, e e o `Entitlement` que o motor
 * consulta. Antes desta correcao o direito so nascia na importacao da base do
 * Pacto (F48); quem era cadastrado ou promovido pelo painel ficava "Sem plano
 * vigente" e barrado na catraca.
 *
 * Mesma forma da importacao (`packages/database/src/import-ativos`): 12 meses
 * a partir de agora, janela livre (7 dias, 0h as 24h) em cada unidade, e as
 * linhas de `EntitlementUnitWindow` -- sem elas o direito existe e a catraca
 * continua fechada com `WRONG_UNIT`.
 */
export const MESES_DE_VINCULO = 12;

const ORIGENS_DE_VINCULO = ['EMPLOYEE', 'PERSONAL_TRAINER'] as const;

type OrigemDeVinculo = (typeof ORIGENS_DE_VINCULO)[number];

/**
 * Origem do direito por perfil. Permuta e "igual ao professor" (schema), e
 * professor e personal sao o mesmo perfil `TRAINER`.
 */
export function origemDoVinculo(perfil: StudentProfile): OrigemDeVinculo | null {
  switch (perfil) {
    case 'STUDENT':
      return null;
    case 'TRAINER':
    case 'PERMUTA_TACIO':
    case 'PERMUTA_DOUGLAS':
      return 'PERSONAL_TRAINER';
    case 'STAFF':
    case 'ADMIN':
      return 'EMPLOYEE';
  }
}

/**
 * Garante o direito de vinculo da pessoa com este perfil. Idempotente.
 *
 * - ja ha direito vigente da origem certa: nao faz nada;
 * - ha direito SUSPENDIDO da origem certa e ainda dentro da validade (o
 *   rebaixamento a aluno suspende, e promover de volta deve reativar): reativa;
 * - senao: cria um novo.
 *
 * Direito de OUTRA origem de vinculo (era professor, virou staff) e suspenso,
 * para a ficha nao mostrar a origem errada. Direito de assinatura
 * (`subscriptionId` preenchido) nunca e tocado.
 *
 * Roda na transacao de quem chama (`tx`).
 */
export async function garantirDireitoDeVinculo(
  tx: Prisma.TransactionClient,
  dados: {
    tenantId: string;
    studentId: string;
    perfil: StudentProfile;
    agora: Date;
    /** Quem concedeu; `null` quando o sistema concede (backfill). */
    grantedById: string | null;
  },
): Promise<'ja-vigente' | 'reativado' | 'criado' | 'nao-se-aplica'> {
  const origem = origemDoVinculo(dados.perfil);

  if (origem === null) return 'nao-se-aplica';

  const { tenantId, studentId, agora } = dados;
  const doVinculo = { tenantId, studentId, subscriptionId: null };

  await tx.entitlement.updateMany({
    where: {
      ...doVinculo,
      source: { in: ORIGENS_DE_VINCULO.filter((o) => o !== origem) },
      status: { in: ['SCHEDULED', 'ACTIVE'] },
    },
    data: { status: 'SUSPENDED', suspendedAt: agora },
  });

  const vigente = await tx.entitlement.findFirst({
    where: {
      ...doVinculo,
      source: origem,
      status: { in: ['SCHEDULED', 'ACTIVE'] },
      endsAt: { gt: agora },
    },
    select: { id: true },
  });

  if (vigente) return 'ja-vigente';

  const suspenso = await tx.entitlement.findFirst({
    where: { ...doVinculo, source: origem, status: 'SUSPENDED', endsAt: { gt: agora } },
    orderBy: { endsAt: 'desc' },
    select: { id: true },
  });

  if (suspenso) {
    await tx.entitlement.update({
      where: { id: suspenso.id },
      data: { status: 'ACTIVE', suspendedAt: null },
    });

    return 'reativado';
  }

  const unidades = await tx.gymUnit.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const gymUnitIds = unidades.map((u) => u.id);

  // Eixo do motor: 0..6, domingo = 0 (nao converta para ISO 1..7).
  const janelas = gymUnitIds.flatMap((gymUnitId) =>
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      gymUnitId,
      dayOfWeek,
      startMinute: 0,
      endMinute: 1440,
    })),
  );

  const fim = new Date(agora);

  fim.setUTCMonth(fim.getUTCMonth() + MESES_DE_VINCULO);

  await tx.entitlement.create({
    data: {
      tenantId,
      studentId,
      source: origem,
      subscriptionId: null,
      status: 'ACTIVE',
      startsAt: agora,
      endsAt: fim,
      grantedById: dados.grantedById,
      reason: `Vinculo (perfil ${dados.perfil}) -- concedido ao cadastrar ou trocar o perfil`,
      policySnapshot: {
        planId: null,
        planName: `Vinculo ${dados.perfil}`,
        snapshotVersion: 1,
        gymUnitIds,
        janelas,
      },
      unitWindows: {
        create: janelas.map((janela) => ({ tenantId, ...janela })),
      },
    },
  });

  return 'criado';
}
