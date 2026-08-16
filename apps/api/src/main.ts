import 'reflect-metadata';

import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts`. Em producao as variaveis vem do ambiente e este
// arquivo simplesmente nao existe; `dotenv` ignora a ausencia em silencio,
// que e o comportamento certo aqui.
//
// A partir do `cwd`, e nao de `import.meta.url`: o caminho relativo mudaria
// entre `src/` (tsx) e `dist/` (compilado), e o pnpm ja executa o script com
// o cwd no workspace.
//
// ORDEM IMPORTA: antes de qualquer import que leia `process.env`.
carregarEnv({ path: join(process.cwd(), '../../.env') });

const { AppModule } = await import('./app.module.js');
const { aplicarParserComCorpoCru } = await import('./common/http/bootstrap-http.js');

/**
 * Porta 3344 e fixa por decisao registrada (`CLAUDE.md`, Regras de trabalho):
 * se estiver ocupada, o processo falha em vez de escorregar para a proxima.
 * Framework que troca de porta sozinho deixa dois processos servindo, com o
 * operador falando com um e lendo o log do outro.
 */
const PORTA = 3344;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Antes do `listen`: a assinatura do Edge e verificada sobre o corpo cru,
  // e o parser padrao do Nest o descarta depois de parsear.
  aplicarParserComCorpoCru(app);

  await app.listen(PORTA);
  console.log(`api ouvindo em http://localhost:${PORTA}`);
}

bootstrap().catch((erro: unknown) => {
  console.error('falha ao subir a api:', erro);
  process.exit(1);
});
