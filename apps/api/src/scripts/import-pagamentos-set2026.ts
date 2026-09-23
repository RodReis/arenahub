/**
 * Importacao de pagamentos de setembro/2026 (Arena Positiva) -- issue #386.
 *
 * DUAS FASES, nunca uma so chamada:
 *
 *   IMPORT_PAGAMENTOS_JSON_PATH=/caminho/dados_pagamentos.json \
 *   IMPORT_PAGAMENTOS_OPERADOR_EMAIL=dono@arena-positiva.test \
 *   node dist/scripts/import-pagamentos-set2026.js --dry-run
 *
 *   IMPORT_PAGAMENTOS_JSON_PATH=/caminho/dados_pagamentos.json \
 *   IMPORT_PAGAMENTOS_OPERADOR_EMAIL=dono@arena-positiva.test \
 *   node dist/scripts/import-pagamentos-set2026.js --gravar
 *
 * `--dry-run` (ou nenhuma flag) SO LE e imprime os baldes -- nunca grava.
 * `--gravar` reconcilia SOMENTE o balde PRONTO, um pagamento por vez, via
 * `BillingRepository.registrarPagamentoManual` -- o MESMO caminho que a
 * recepcao usa na tela, dentro de um `NestFactory.createApplicationContext`.
 *
 * PRECISA DE BUILD (`pnpm --filter @arenahub/api build`) antes de rodar --
 * `tsx` nao emite `design:paramtypes`, e sem esse metadado o Nest nao
 * resolve `BillingRepository` por tipo (mesma razao do `dev` nao usar
 * `tsx`, ver `package.json`).
 *
 * O JSON e DADO REAL DE ALUNO e nunca entra no repositorio (`CLAUDE.md`). O
 * caminho vem de `IMPORT_PAGAMENTOS_JSON_PATH`, fora da arvore versionada.
 */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: join(process.cwd(), '../../.env') });

import { NestFactory } from '@nestjs/core';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../app.module.js';
import { BillingRepository } from '../modules/billing/billing.repository.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { gravarPagamentosProntos, planejarImportacao, type RelatorioDoDryRun } from './import-pagamentos-set2026/importar.js';
import type { LinhaDeRelatorio } from './import-pagamentos-set2026/dominio.js';

const TENANT_SLUG = 'arena-positiva';

interface ArquivoDePagamentos {
  pagamentos: { nome: string; data: string; valor: number }[];
}

function lerVariavelObrigatoria(nome: string): string {
  const valor = process.env[nome];

  if (!valor) {
    throw new Error(`${nome} nao definida. Ver o cabecalho deste arquivo para a lista completa.`);
  }

  return valor;
}

async function lerLinhas(caminho: string): Promise<LinhaDeRelatorio[]> {
  const conteudo = await readFile(caminho, 'utf8');
  const arquivo = JSON.parse(conteudo) as ArquivoDePagamentos;

  return arquivo.pagamentos.map((p) => ({ nome: p.nome, data: p.data, valor: p.valor }));
}

function imprimirRelatorio(relatorio: RelatorioDoDryRun): void {
  console.info(`\n[import-pagamentos] PRONTOS: ${String(relatorio.prontos.length)}`);
  console.table(
    relatorio.prontos.map((p) => ({
      nome: p.nome,
      amountMinor: p.amountMinor,
      valorDaInvoiceMinor: p.valorDaInvoiceMinor,
      valorDivergente: p.amountMinor !== p.valorDaInvoiceMinor ? 'SIM' : '',
    })),
  );

  console.info(`\n[import-pagamentos] DUPLICADO NO ARQUIVO: ${String(relatorio.duplicadosNoArquivo.length)}`);
  console.table(relatorio.duplicadosNoArquivo);

  console.info(`\n[import-pagamentos] AMBIGUO (2+ alunos com o mesmo nome): ${String(relatorio.ambiguos.length)}`);
  console.table(relatorio.ambiguos);

  console.info(`\n[import-pagamentos] NAO ENCONTRADO: ${String(relatorio.naoEncontrados.length)}`);
  console.table(relatorio.naoEncontrados);

  console.info(`\n[import-pagamentos] SEM INVOICE ABERTA: ${String(relatorio.semInvoiceAberta.length)}`);
  console.table(relatorio.semInvoiceAberta);

  const total =
    relatorio.prontos.length +
    relatorio.duplicadosNoArquivo.length +
    relatorio.ambiguos.length +
    relatorio.naoEncontrados.length +
    relatorio.semInvoiceAberta.length;

  console.info(`\n[import-pagamentos] total classificado: ${String(total)}`);
}

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');

  const caminho = lerVariavelObrigatoria('IMPORT_PAGAMENTOS_JSON_PATH');
  const emailDoOperador = lerVariavelObrigatoria('IMPORT_PAGAMENTOS_OPERADOR_EMAIL');

  const linhas = await lerLinhas(caminho);
  console.info(`[import-pagamentos] ${String(linhas.length)} linhas lidas de ${caminho}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const db = app.get(PrismaService);
    const billing = app.get(BillingRepository);

    // `Student` tem RLS ativa (F66) -- sem `comContexto`, o role restrito nao
    // enxerga NENHUMA linha, e o dry-run classificaria todo mundo como
    // NAO_ENCONTRADO em silencio. `Tenant` fica FORA do bloco de proposito:
    // nao tem politica ainda, e e a consulta que da o `tenantId` que o
    // `comContexto` precisa.
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

    await comContexto({ kind: 'system', tenantId: tenant.id }, async () => {
      const relatorio = await planejarImportacao(db, tenant.id, linhas);

      imprimirRelatorio(relatorio);

      if (!gravar) {
        console.info('\n[import-pagamentos] dry-run -- nada foi gravado. Rode com --gravar para reconciliar os PRONTOS.');
        return;
      }

      // Decisao do PI (23/09/2026): so grava valor pago == valor da invoice.
      // Os divergentes (sobrepagamento vira credito, valor menor e recusado
      // como parcial pela propria regra de negocio) ficam de fora desta
      // rodada -- revisao manual decide caso a caso depois.
      const semDivergencia = relatorio.prontos.filter((p) => p.amountMinor === p.valorDaInvoiceMinor);
      const comDivergencia = relatorio.prontos.filter((p) => p.amountMinor !== p.valorDaInvoiceMinor);

      if (comDivergencia.length > 0) {
        console.info(
          `\n[import-pagamentos] ${String(comDivergencia.length)} PRONTO com valor divergente da invoice -- FICAM DE FORA desta gravacao:`,
        );
        console.table(comDivergencia.map((p) => ({ nome: p.nome, amountMinor: p.amountMinor, valorDaInvoiceMinor: p.valorDaInvoiceMinor })));
      }

      if (semDivergencia.length === 0) {
        console.info('\n[import-pagamentos] nenhum pagamento PRONTO sem divergencia para gravar.');
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

      const resultado = await gravarPagamentosProntos(
        (entrada) => billing.registrarPagamentoManual(contexto, entrada, randomUUID()),
        semDivergencia,
      );

      console.info(`\n[import-pagamentos] reconciliados: ${String(resultado.reconciliados)}`);
      console.info(`[import-pagamentos] falhas: ${String(resultado.falhas.length)}`);
      if (resultado.falhas.length > 0) console.table(resultado.falhas);
    });
  } finally {
    await app.close();
  }
}

try {
  await principal();
} catch (erro: unknown) {
  console.error('[import-pagamentos] falhou:', erro);
  process.exitCode = 1;
}
