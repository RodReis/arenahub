/**
 * Consolidacao de assinaturas duplicadas -- issue #390.
 *
 * DUAS FASES, nunca uma so chamada:
 *
 *   node dist/scripts/consolidar-assinaturas-duplicadas.js --dry-run
 *   node dist/scripts/consolidar-assinaturas-duplicadas.js --gravar
 *
 * `--dry-run` (ou nenhuma flag) SO LE e imprime o que seria feito -- nunca
 * grava. `--gravar` aplica, aluno por aluno, via
 * `MembershipRepository.consolidarAssinaturaDuplicada` -- o mesmo caminho
 * que preserva (migra) o entitlement de risco em vez de revoga-lo. Ver
 * `consolidar-assinaturas-duplicadas/dominio.ts` para a regra completa e o
 * porque dela.
 *
 * PRECISA DE BUILD (`pnpm --filter @arenahub/api build`) antes de rodar --
 * mesma razao do import de pagamentos (#387): `tsx` nao emite
 * `design:paramtypes`, o Nest nao resolve `MembershipRepository` por tipo.
 */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: join(process.cwd(), '../../.env') });

import { NestFactory } from '@nestjs/core';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../app.module.js';
import { MembershipRepository } from '../modules/membership/membership.repository.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  decidirConsolidacaoDoAluno,
  type AssinaturaParaConsolidar,
  type VereditoDoAluno,
} from './consolidar-assinaturas-duplicadas/dominio.js';

const TENANT_SLUG = 'arena-positiva';

function lerVariavelObrigatoria(nome: string): string {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(`${nome} nao definida. Ver o cabecalho deste arquivo para a lista completa.`);
  }

  return valor;
}

interface PlanoDeConsolidacao {
  studentId: string;
  veredito: Extract<VereditoDoAluno, { tipo: 'CONSOLIDAR' }>;
}

function imprimirRelatorio(planos: PlanoDeConsolidacao[], pendencias: number, agora: Date): void {
  const totalEncerradas = planos.reduce((soma, p) => soma + p.veredito.encerrar.length, 0);
  const totalMigracoes = planos.reduce(
    (soma, p) => soma + p.veredito.encerrar.filter((e) => e.entitlementParaMigrar).length,
    0,
  );

  console.info(`\n[consolidar-assinaturas] alunos consolidaveis     : ${String(planos.length)}`);
  console.info(`[consolidar-assinaturas] assinaturas a encerrar   : ${String(totalEncerradas)}`);
  console.info(`[consolidar-assinaturas] entitlements a MIGRAR    : ${String(totalMigracoes)}  (preserva acesso)`);
  console.info(`[consolidar-assinaturas] pendencias (2+ ACTIVE)   : ${String(pendencias)}  (nao tocadas)`);
  console.info(`[consolidar-assinaturas] medido em                : ${agora.toISOString()}`);
}

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');
  const emailDoOperador = lerVariavelObrigatoria('CONSOLIDAR_OPERADOR_EMAIL');
  const agora = new Date();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const db = app.get(PrismaService);
    const membership = app.get(MembershipRepository);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

    await comContexto({ kind: 'system', tenantId: tenant.id }, async () => {
      const assinaturas = await db.comTenant((tx) =>
        tx.subscription.findMany({
          where: { tenantId: tenant.id },
          select: {
            id: true,
            studentId: true,
            status: true,
            startsAt: true,
            entitlements: { select: { id: true, status: true, startsAt: true, endsAt: true } },
          },
          orderBy: { startsAt: 'desc' },
        }),
      );

      const porAluno = new Map<string, typeof assinaturas>();
      for (const a of assinaturas) {
        const grupo = porAluno.get(a.studentId);
        if (grupo) grupo.push(a);
        else porAluno.set(a.studentId, [a]);
      }

      const planos: PlanoDeConsolidacao[] = [];
      let pendencias = 0;

      for (const [studentId, grupo] of porAluno) {
        const entrada: AssinaturaParaConsolidar[] = grupo.map((a) => ({
          id: a.id,
          status: a.status,
          startsAt: a.startsAt,
          entitlements: a.entitlements,
        }));

        const veredito = decidirConsolidacaoDoAluno(entrada, agora);

        if (veredito.tipo === 'CONSOLIDAR') {
          planos.push({ studentId, veredito });
        } else if (veredito.motivo === 'DUAS_OU_MAIS_ACTIVE') {
          pendencias += 1;
        }
      }

      imprimirRelatorio(planos, pendencias, agora);

      if (!gravar) {
        console.info('\n[consolidar-assinaturas] dry-run -- nada foi gravado. Rode com --gravar para aplicar.');
        return;
      }

      const operador = await db.user.findUniqueOrThrow({ where: { email: emailDoOperador } });
      const contexto = {
        tenantId: tenant.id,
        actorId: operador.id,
        sessionId: randomUUID(),
        permissions: new Set<string>(),
        allowedUnitIds: 'ALL' as const,
      };

      let encerradas = 0;
      let migradas = 0;
      const falhas: { assinaturaId: string; erro: string }[] = [];

      for (const plano of planos) {
        for (const item of plano.veredito.encerrar) {
          try {
            await membership.consolidarAssinaturaDuplicada(
              contexto,
              {
                assinaturaId: item.assinaturaId,
                sobreviventeId: plano.veredito.sobreviventeId,
                entitlementParaMigrarId: item.entitlementParaMigrar,
                reason: 'Consolidacao de assinatura duplicada (import F47/F48, issue #390)',
              },
              randomUUID(),
              agora,
            );
            encerradas += 1;
            if (item.entitlementParaMigrar) migradas += 1;
          } catch (erro: unknown) {
            falhas.push({
              assinaturaId: item.assinaturaId,
              erro: erro instanceof Error ? erro.message : String(erro),
            });
          }
        }
      }

      console.info(`\n[consolidar-assinaturas] encerradas : ${String(encerradas)}`);
      console.info(`[consolidar-assinaturas] migradas   : ${String(migradas)}`);
      console.info(`[consolidar-assinaturas] falhas     : ${String(falhas.length)}`);
      if (falhas.length > 0) console.table(falhas);
    });
  } finally {
    await app.close();
  }
}

try {
  await principal();
} catch (erro: unknown) {
  console.error('[consolidar-assinaturas] falhou:', erro);
  process.exitCode = 1;
}
