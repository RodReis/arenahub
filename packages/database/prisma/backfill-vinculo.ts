/**
 * Correcao de dado da issue #662 -- professor/staff sem direito de vinculo.
 *
 *   pnpm --filter @arenahub/database backfill:vinculo            # so relata
 *   pnpm --filter @arenahub/database backfill:vinculo --aplicar  # grava
 *
 * O QUE ACONTECEU. O direito por vinculo (`PERSONAL_TRAINER` / `EMPLOYEE`)
 * so nascia na importacao da base do Pacto (F48). Quem foi cadastrado ou
 * promovido a professor/staff/admin pelo painel ficou com `profile != STUDENT`
 * e NENHUM direito: ficha "Sem plano vigente" e catraca negando. O codigo ja
 * foi corrigido (`garantirDireitoDeVinculo`, na API) -- este script conserta
 * quem foi criado ANTES da correcao.
 *
 * O QUE FAZ, por pessoa com `profile != STUDENT` e cadastro `ACTIVE`:
 *   - ja tem direito de vinculo vigente da origem certa: nao toca;
 *   - tem direito suspenso da origem certa e ainda valido: reativa;
 *   - senao: concede um novo (12 meses, janela livre nas unidades ativas),
 *     com o mesmo snapshot da importacao (`montarSnapshot`).
 *
 * IDEMPOTENTE: depois de rodar, ninguem cai no filtro de novo.
 * SEGURO POR PADRAO: sem `--aplicar` apenas lista o que faria.
 * Roda contra a `DATABASE_URL` de quem chama; nada de URL fixa aqui.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';
import { MESES_DE_VINCULO, montarSnapshot } from '../src/import-ativos/importar.js';

type Origem = 'EMPLOYEE' | 'PERSONAL_TRAINER';

/** Espelho de `origemDoVinculo` (`apps/api/.../team/direito-de-vinculo.ts`). */
function origemDoPerfil(perfil: string): Origem | null {
  if (perfil === 'TRAINER' || perfil === 'PERMUTA_TACIO' || perfil === 'PERMUTA_DOUGLAS') {
    return 'PERSONAL_TRAINER';
  }
  if (perfil === 'STAFF' || perfil === 'ADMIN') return 'EMPLOYEE';

  return null;
}

async function corrigir(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const agora = new Date();
  const db = criarPrismaClient();

  try {
    const pessoas = await db.student.findMany({
      where: { profile: { not: 'STUDENT' }, status: 'ACTIVE' },
      select: { id: true, tenantId: true, fullName: true, profile: true },
      orderBy: [{ tenantId: 'asc' }, { fullName: 'asc' }],
    });

    let reativados = 0;
    let criados = 0;
    let jaVigentes = 0;

    for (const pessoa of pessoas) {
      const origem = origemDoPerfil(pessoa.profile);

      if (origem === null) continue;

      const doVinculo = { tenantId: pessoa.tenantId, studentId: pessoa.id, subscriptionId: null };

      const vigente = await db.entitlement.findFirst({
        where: { ...doVinculo, source: origem, status: { in: ['SCHEDULED', 'ACTIVE'] }, endsAt: { gt: agora } },
        select: { id: true },
      });

      if (vigente) {
        jaVigentes += 1;
        continue;
      }

      const suspenso = await db.entitlement.findFirst({
        where: { ...doVinculo, source: origem, status: 'SUSPENDED', endsAt: { gt: agora } },
        orderBy: { endsAt: 'desc' },
        select: { id: true },
      });

      if (suspenso) {
        console.info(`  - ${pessoa.fullName} (${pessoa.profile}): reativa direito suspenso${aplicar ? '' : ' (simulacao)'}`);

        if (aplicar) {
          await db.entitlement.update({
            where: { id: suspenso.id },
            data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
          });
        }

        reativados += 1;
        continue;
      }

      console.info(`  - ${pessoa.fullName} (${pessoa.profile}): concede ${origem}${aplicar ? '' : ' (simulacao)'}`);
      criados += 1;

      if (!aplicar) continue;

      await db.$transaction(async (tx) => {
        const unidades = await tx.gymUnit.findMany({
          where: { tenantId: pessoa.tenantId, status: 'ACTIVE' },
          select: { id: true },
        });

        const snapshot = montarSnapshot(
          null,
          pessoa.profile === 'STAFF' ? 'STAFF' : pessoa.profile === 'ADMIN' ? 'ADMIN' : 'TRAINER',
          unidades.map((u) => u.id),
        );

        const fim = new Date(agora);

        fim.setUTCMonth(fim.getUTCMonth() + MESES_DE_VINCULO);

        await tx.entitlement.create({
          data: {
            tenantId: pessoa.tenantId,
            studentId: pessoa.id,
            source: origem,
            subscriptionId: null,
            status: 'ACTIVE',
            startsAt: agora,
            endsAt: fim,
            reason: `Vinculo (perfil ${pessoa.profile}) -- correcao de dado da issue #662`,
            policySnapshot: { ...snapshot },
            unitWindows: {
              create: snapshot.janelas.map((janela) => ({ tenantId: pessoa.tenantId, ...janela })),
            },
          },
        });
      });
    }

    console.info(
      `[backfill-vinculo] ${String(pessoas.length)} pessoa(s) com perfil de vinculo e cadastro ativo: ` +
        `${String(jaVigentes)} ja vigente(s), ${String(reativados)} a reativar, ${String(criados)} a conceder.`,
    );

    if (!aplicar) {
      console.info('[backfill-vinculo] SIMULACAO -- nada foi gravado. Repita com --aplicar para valer.');
    }
  } finally {
    await db.$disconnect();
  }
}

await corrigir();
