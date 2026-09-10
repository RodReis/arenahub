/**
 * Correcao de dado da issue #188 -- entitlement com snapshot de politica vazio.
 *
 *   pnpm --filter @arenahub/database fix:188
 *
 * O QUE ACONTECEU. O seed criava plano sem unidade e sem janela de acesso,
 * contornando o `min(1)` que `POST /plans` exige. Atribuir um desses planos
 * produzia entitlement `ACTIVE` com `policySnapshot.janelas` vazio: a ficha
 * dizia que o aluno tinha acesso e a catraca negava. O seed ja foi corrigido
 * e a API ganhou a guarda `PLAN_HAS_NO_ACCESS_WINDOW` -- este script conserta
 * o que foi emitido ANTES das duas correcoes.
 *
 * POR QUE NAO UM `UPDATE` NO SNAPSHOT. O snapshot e imutavel por desenho: ele
 * congela a politica vigente no instante da concessao, e e o que o motor de
 * decisao replica quando precisa explicar por que liberou ou negou um acesso
 * passado. Reescrever o campo faria a explicacao de ontem citar a regra de
 * hoje. A correcao honesta e REEMITIR: revoga o direito quebrado e concede um
 * novo, com data e motivo proprios, deixando os dois visiveis na ficha.
 *
 * IDEMPOTENTE. Roda quantas vezes for preciso: so toca em entitlement cujo
 * snapshot esta vazio, e o direito reemitido ja nasce com janela -- portanto
 * fica de fora na proxima passada.
 *
 * SEGURO POR PADRAO. Sem argumento ele apenas RELATA o que faria. Para
 * aplicar, passe `--aplicar`.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';

const MOTIVO = 'Reemissao do direito de acesso: plano estava sem janela (issue #188)';

/*
 * `type`, NAO `interface`: o snapshot vai para uma coluna `Json`, e
 * `InputJsonValue` exige index signature -- que um alias de tipo tem por
 * inferencia e uma interface nao. Trocar aqui evita o `as unknown as` que
 * calaria o compilador sem provar nada.
 */
type Janela = {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

async function corrigir(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const db = criarPrismaClient();

  try {
    /*
     * So o que ainda vale a pena consertar. Direito ja revogado ou expirado
     * nao libera catraca nenhuma -- reemitir agora criaria acesso que nunca
     * existiu, o oposto de corrigir dado.
     */
    const quebrados = await db.entitlement.findMany({
      where: { status: { in: ['ACTIVE', 'SCHEDULED'] } },
      include: { student: { select: { fullName: true } } },
    });

    const alvos = quebrados.filter((e) => {
      const snapshot = e.policySnapshot as { janelas?: unknown[] } | null;

      return Array.isArray(snapshot?.janelas) && snapshot.janelas.length === 0;
    });

    if (alvos.length === 0) {
      console.info('[fix-188] nenhum entitlement com snapshot vazio. Nada a fazer.');

      return;
    }

    console.info(`[fix-188] ${String(alvos.length)} entitlement(s) com snapshot vazio:`);

    let reemitidos = 0;
    let semPlano = 0;

    for (const antigo of alvos) {
      const snapshot = antigo.policySnapshot as { planId?: string; planName?: string };
      const planId = snapshot.planId;

      if (planId === undefined) {
        console.warn(`  - ${antigo.id}: snapshot sem planId; pulado (exige analise manual).`);
        semPlano += 1;
        continue;
      }

      const plano = await db.plan.findUnique({
        where: { id: planId },
        include: { units: true, accessWindows: true },
      });

      /*
       * PLANO AINDA SEM JANELA = NAO HA O QUE REEMITIR. Reemitir daria outro
       * direito igualmente vazio, trocando um registro quebrado por outro.
       * Cadastre o horario do plano e rode de novo.
       */
      if (!plano || plano.accessWindows.length === 0) {
        console.warn(
          `  - ${antigo.id} (${antigo.student.fullName}): plano "${snapshot.planName ?? planId}" continua sem janela; corrija o plano antes.`,
        );
        semPlano += 1;
        continue;
      }

      const janelas: Janela[] = plano.accessWindows.map((j) => ({
        gymUnitId: j.gymUnitId,
        dayOfWeek: j.dayOfWeek,
        startMinute: j.startMinute,
        endMinute: j.endMinute,
      }));

      console.info(
        `  - ${antigo.student.fullName}: "${plano.name}" -> ${String(janelas.length)} janela(s)${aplicar ? '' : ' (simulacao)'}`,
      );

      if (!aplicar) continue;

      /*
       * REVOGA E CONCEDE NA MESMA TRANSACAO. Fora dela, uma falha no meio
       * deixaria o aluno sem direito nenhum -- pior que o estado atual, onde
       * ao menos o cadastro aparece na ficha.
       */
      await db.$transaction(async (tx) => {
        await tx.entitlement.update({
          where: { id: antigo.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            reason: MOTIVO,
            version: { increment: 1 },
          },
        });

        await tx.entitlement.create({
          data: {
            tenantId: antigo.tenantId,
            studentId: antigo.studentId,
            source: antigo.source,
            subscriptionId: antigo.subscriptionId,
            status: antigo.status,
            startsAt: antigo.startsAt,
            endsAt: antigo.endsAt,
            reason: MOTIVO,
            policySnapshot: {
              planId: plano.id,
              planName: plano.name,
              snapshotVersion: 1,
              gymUnitIds: plano.units.map((u) => u.gymUnitId).sort(),
              janelas,
            },
            unitWindows: { create: janelas.map((j) => ({ ...j, tenantId: antigo.tenantId })) },
          },
        });
      });

      reemitidos += 1;
    }

    if (aplicar) {
      console.info(
        `[fix-188] ${String(reemitidos)} reemitido(s), ${String(semPlano)} pendente(s) de correcao do plano.`,
      );
    } else {
      console.info('[fix-188] SIMULACAO -- nada foi gravado. Repita com --aplicar para valer.');
    }
  } finally {
    await db.$disconnect();
  }
}

await corrigir();
