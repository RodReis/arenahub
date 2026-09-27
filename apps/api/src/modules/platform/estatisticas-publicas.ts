import { comContexto } from '@arenahub/database';

import type { PrismaService } from '../../persistence/prisma.service.js';

export interface EstatisticasPublicas {
  totalAlunosAtivos: number;
  totalUnidadesAtivas: number;
}

/**
 * Alunos e unidades ativos, somados entre TODOS os tenants -- para a tela de
 * login antes da autenticacao, onde nao ha um tenant a perguntar.
 *
 * `comContexto({ kind: 'system', tenantId })`, UM POR TENANT, e nao
 * `{ kind: 'platform' }`: aquele contexto e a excecao ao isolamento e existe
 * SO para a sessao elevada de Super Admin, auditada (rls.ts, ADR-052 §3) --
 * esta rota e publica e nao tem sessao nenhuma para auditar. `system` e o
 * mesmo escopo que `contarAlunosDoTenant` ja usa fora de requisicao HTTP; some
 * as leituras nao apaga a barreira entre tenants dentro de cada uma.
 *
 * `tenant` NAO TEM POLITICA RLS -- `TenantRepository.porId` ja le sem
 * `comTenant`, e a listagem aqui segue o mesmo precedente.
 */
export async function contarEstatisticasPublicas(
  db: PrismaService,
): Promise<EstatisticasPublicas> {
  const tenants = await db.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });

  // SERIALIZADO, e nao Promise.all: uma transacao por tenant, todas em
  // paralelo, disputava o pool de conexoes do Postgres e estourava com N
  // tenants ativos crescendo (issue #417). Rota publica de tela de login,
  // sem requisito de latencia que justifique concorrencia.
  const acumulado: EstatisticasPublicas = { totalAlunosAtivos: 0, totalUnidadesAtivas: 0 };

  for (const { id: tenantId } of tenants) {
    const [alunos, unidades] = await comContexto({ kind: 'system', tenantId }, () =>
      db.comTenant((tx) =>
        Promise.all([
          tx.student.count({ where: { tenantId, profile: 'STUDENT', status: 'ACTIVE' } }),
          tx.gymUnit.count({ where: { tenantId, status: 'ACTIVE' } }),
        ]),
      ),
    );

    acumulado.totalAlunosAtivos += alunos;
    acumulado.totalUnidadesAtivas += unidades;
  }

  return acumulado;
}
