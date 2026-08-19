/* eslint-disable no-console -- programa de linha de comando: console e a interface, nao debug esquecido (mesma excecao de prisma/seed.ts). */
/**
 * Importacao da base legada Pacto -- F47, issue #118, ADR-033.
 *
 *   PACTO_IMPORT_JSON_PATH=/caminho/alunos.json pnpm --filter @arenahub/database import:pacto
 *
 * SEPARADO do `seed.ts` de proposito: roda MANUALMENTE, uma vez, contra a
 * `DATABASE_URL` de quem chama -- local hoje, producao quando a nuvem subir.
 * Nunca entra no pipeline de deploy nem no `pretest`. `criarPrismaClient` ja
 * le `DATABASE_URL` do ambiente, entao apontar para producao e so exportar a
 * variavel antes de chamar -- nenhuma URL fica hardcoded aqui.
 *
 * O JSON e DADO REAL DE ALUNO e nunca entra no repositorio (`CLAUDE.md`). O
 * caminho vem de `PACTO_IMPORT_JSON_PATH`, fora da arvore versionada.
 *
 * A logica de gravacao mora em `src/import-pacto/importar.ts` -- testavel com
 * client injetado. Este arquivo so le o JSON, resolve tenant/plano/unidade e
 * imprime relatorio.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { readFile } from 'node:fs/promises';

import { criarPrismaClient } from '../src/client.js';
import { importarRegistros, relatorioDePreenchimento } from '../src/import-pacto/importar.js';
import type { RegistroPacto } from '../src/import-pacto/parser.js';

const TENANT_SLUG = 'arena-positiva';
const CODIGO_DA_UNIDADE = 'MATRIZ';
const NOME_DO_PLANO = 'Programa Adultos e Idosos';

async function lerRegistros(caminho: string): Promise<RegistroPacto[]> {
  const conteudo = await readFile(caminho, 'utf8');

  return JSON.parse(conteudo) as RegistroPacto[];
}

async function importar(): Promise<void> {
  const caminho = process.env['PACTO_IMPORT_JSON_PATH'];

  if (!caminho) {
    throw new Error(
      'PACTO_IMPORT_JSON_PATH nao definida. Aponte para o JSON exportado do ' +
        'Pacto -- ele nunca entra no repositorio (CLAUDE.md).',
    );
  }

  const registros = await lerRegistros(caminho);

  console.info(`[import-pacto] ${String(registros.length)} registros lidos de ${caminho}`);
  console.table(relatorioDePreenchimento(registros));

  const db = criarPrismaClient();

  try {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
    const plano = await db.plan.findFirstOrThrow({
      where: { tenantId: tenant.id, name: NOME_DO_PLANO },
    });
    const unidade = await db.gymUnit.findFirstOrThrow({
      where: { tenantId: tenant.id, code: CODIGO_DA_UNIDADE },
    });

    const resultado = await importarRegistros(
      db,
      { tenantId: tenant.id, planId: plano.id, gymUnitId: unidade.id },
      registros,
    );

    console.info(
      `[import-pacto] ${String(resultado.criados)} alunos criados, ${String(resultado.atualizados)} atualizados.`,
    );
    console.info(`[import-pacto] ${String(resultado.rejeitados.length)} registros rejeitados (pendencia):`);
    console.table(resultado.rejeitados);
  } finally {
    await db.$disconnect();
  }
}

try {
  await importar();
} catch (erro: unknown) {
  console.error('[import-pacto] falhou:', erro);
  process.exitCode = 1;
}
