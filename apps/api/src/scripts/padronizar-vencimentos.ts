/**
 * Saneamento da F88 (SPEC-088) -- padroniza vencimento, cobertura e carencia.
 *
 * Sem `--gravar` SO LE e imprime o plano. Idempotente: a segunda execucao com
 * `--gravar` nao muda nada. Precisa de build antes (`tsx` nao emite
 * `design:paramtypes`). Nao imprime nome nem CPF -- so contagens, ids e
 * matriculas. Para se o `dueDay` do tenant nao for 10.
 *
 * QUAL BANCO. O runtime usa `RUNTIME_DATABASE_URL` COM PRIORIDADE e so cai em
 * `DATABASE_URL` se aquela for vazia. O `.env` do repositorio tem RUNTIME
 * apontando para o localhost e `DATABASE_URL` para a producao, e o dotenv NAO
 * sobrescreve variavel ja exportada -- entao exporte as duas no comando. O
 * script imprime `banco-alvo : host:porta/banco` (sem credencial) antes de
 * consultar, e com `--gravar` recusa se `PADRONIZAR_CONFIRMA_BANCO` nao for
 * exatamente esse rotulo.
 *
 *   # dry-run
 *   DATABASE_URL=<url-do-banco> RUNTIME_DATABASE_URL= \
 *   PADRONIZAR_TENANT_SLUG=arena-positiva \
 *   node dist/scripts/padronizar-vencimentos.js
 *
 *   # gravar (confirma o banco impresso no dry-run)
 *   DATABASE_URL=<url-do-banco> RUNTIME_DATABASE_URL= \
 *   PADRONIZAR_TENANT_SLUG=arena-positiva \
 *   PADRONIZAR_CONFIRMA_BANCO=<host>:<porta>/<banco> \
 *   node dist/scripts/padronizar-vencimentos.js --gravar
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
import {
  exigirConfirmacaoDoBanco,
  rotuloDoBanco,
  silenciarAgendadores,
} from './padronizar-vencimentos/seguranca.js';

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');
  const slug = process.env['PADRONIZAR_TENANT_SLUG'] ?? 'arena-positiva';

  // Antes de abrir o app (e de qualquer consulta): mostra e confere o alvo.
  const rotulo = rotuloDoBanco(process.env);

  if (!rotulo) {
    console.error('[padronizar] banco-alvo : <ilegivel> -- abortado');
    process.exitCode = 1;
    return;
  }

  console.info(`[padronizar] banco-alvo : ${rotulo}`);
  exigirConfirmacaoDoBanco(gravar, rotulo, process.env['PADRONIZAR_CONFIRMA_BANCO']);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    // Antes da primeira consulta: nenhum @Cron/@Interval pode escrever no banco.
    silenciarAgendadores(app);

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
