/**
 * Diagnostico (SO LEITURA) -- aluno com plano vigente negado como "Sem plano vigente".
 *
 *   pnpm --filter @arenahub/database diagnostico:identidade
 *
 * O painel rotula `NO_ENTITLEMENT` como "Sem plano vigente", mas o motivo
 * tambem sai do `IdentityResolver` quando a identidade biometrica nao esta
 * `ACTIVE` ou o vinculo no leitor esta `REMOVED`. Este script lista os alunos
 * ATIVOS com direito vigente (ACTIVE, dentro do periodo) cujo caminho de
 * identidade esta quebrado, e a causa de cada um.
 *
 * Nao escreve nada. Nao imprime CPF, e-mail nem telefone -- so nome e
 * matricula, para a recepcao reconhecer o aluno.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';

interface Linha {
  student_id: string;
  full_name: string;
  causa: string;
  identity_state: string | null;
  revoked_reason: string | null;
  revoked_at: Date | null;
  device_user_state: string | null;
  external_user_id: string | null;
  tentativas_negadas_30d: number;
}

async function diagnosticar(): Promise<void> {
  const db = criarPrismaClient();

  try {
    const linhas = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT set_config($1, $2, true)', 'app.actor', 'platform');

      return tx.$queryRawUnsafe<Linha[]>(`
        WITH vigentes AS (
          SELECT DISTINCT e.student_id
          FROM entitlements e
          WHERE e.status = 'ACTIVE' AND e.starts_at <= now() AND e.ends_at >= now()
        )
        SELECT s.id AS student_id,
               s.full_name,
               CASE
                 WHEN du.id IS NULL THEN 'SEM_VINCULO_NO_LEITOR'
                 WHEN bi.state <> 'ACTIVE' THEN 'IDENTIDADE_' || bi.state
                 WHEN du.state = 'REMOVED' THEN 'VINCULO_REMOVED'
               END AS causa,
               bi.state::text AS identity_state,
               bi.revoked_reason,
               bi.revoked_at,
               du.state::text AS device_user_state,
               du.external_user_id,
               (SELECT count(*)::int FROM access_events ae
                 WHERE ae.student_id = s.id AND ae.outcome = 'DENY'
                   AND ae.reason = 'NO_ENTITLEMENT'
                   AND ae.created_at > now() - interval '30 days') AS tentativas_negadas_30d
        FROM students s
        JOIN vigentes v ON v.student_id = s.id
        LEFT JOIN device_users du ON du.student_id = s.id
        LEFT JOIN biometric_identities bi ON bi.id = du.identity_id
        WHERE s.status = 'ACTIVE'
          AND (du.id IS NULL OR bi.state <> 'ACTIVE' OR du.state = 'REMOVED')
        ORDER BY tentativas_negadas_30d DESC, s.full_name
      `);
    });

    const comTentativa = linhas.filter((l) => l.tentativas_negadas_30d > 0);

    console.info(`[diagnostico] ${String(linhas.length)} aluno(s) ativos com plano vigente e identidade quebrada.`);
    console.info(`[diagnostico] ${String(comTentativa.length)} deles ja foram negados por NO_ENTITLEMENT nos ultimos 30 dias.\n`);

    const porCausa = new Map<string, number>();
    for (const l of linhas) porCausa.set(l.causa, (porCausa.get(l.causa) ?? 0) + 1);
    console.info('Por causa:', Object.fromEntries(porCausa));

    console.info('\nOs que ja tentaram entrar e foram negados:');
    for (const l of comTentativa) {
      console.info(
        `- ${l.full_name} | causa=${l.causa} | leitor=${l.external_user_id ?? '-'} | ` +
          `motivo_revogacao=${l.revoked_reason ?? '-'} | negado=${String(l.tentativas_negadas_30d)}x`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

diagnosticar().catch((erro: unknown) => {
  console.error('[diagnostico] falhou:', erro);
  process.exitCode = 1;
});
