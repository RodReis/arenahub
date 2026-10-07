/**
 * Saneamento da F88 (SPEC-088) -- padroniza vencimento, cobertura e carencia.
 *
 *   PADRONIZAR_TENANT_SLUG=arena-positiva node dist/scripts/padronizar-vencimentos.js [--gravar]
 *
 * Sem `--gravar` SO LE e imprime o plano. Idempotente: a segunda execucao com
 * `--gravar` nao muda nada. Precisa de build antes (`tsx` nao emite
 * `design:paramtypes`). Nao imprime nome nem CPF -- so contagens, ids e
 * matriculas. Para se o `dueDay` do tenant nao for 10.
 */
import 'reflect-metadata';

import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: join(process.cwd(), '../../.env') });

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { BillingRepository } from '../modules/billing/billing.repository.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { executarSaneamento } from './padronizar-vencimentos/executar.js';

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');
  const slug = process.env['PADRONIZAR_TENANT_SLUG'] ?? 'arena-positiva';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const resultado = await executarSaneamento(
      { db: app.get(PrismaService), billing: app.get(BillingRepository) },
      { slug, gravar, agora: new Date() },
    );

    if (resultado.falhas > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

try {
  await principal();
} catch (erro: unknown) {
  console.error('[padronizar] falhou:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
}
