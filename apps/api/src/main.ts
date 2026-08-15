import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

/**
 * Porta 3344 e fixa por decisao registrada (`CLAUDE.md`, Regras de trabalho):
 * se estiver ocupada, o processo falha em vez de escorregar para a proxima.
 * Framework que troca de porta sozinho deixa dois processos servindo, com o
 * operador falando com um e lendo o log do outro.
 */
const PORTA = 3344;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  await app.listen(PORTA);
  console.log(`api ouvindo em http://localhost:${PORTA}`);
}

bootstrap().catch((erro: unknown) => {
  console.error('falha ao subir a api:', erro);
  process.exit(1);
});
