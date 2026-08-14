#!/usr/bin/env node
/**
 * Falha se a porta estiver ocupada. Nao procura outra.
 *
 * CLAUDE.md -> Regras de trabalho: "API 3344 (fixa -- se ocupada, falha em
 * vez de trocar)". Framework que cai na porta seguinte sozinho produz o pior
 * cenario: dois processos servindo, o operador falando com o errado e o log
 * saindo no outro. Colisao vira decisao registrada, nunca troca silenciosa.
 *
 * Uso, no script `dev` da API quando ela existir:
 *   node ../../scripts/check-port.mjs 3344 && nest start --watch
 */
import { createServer } from 'node:net';

const porta = Number(process.argv[2]);
const nome = process.argv[3] ?? 'servico';

if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error('uso: node scripts/check-port.mjs <porta> [nome]');
  process.exit(2);
}

const servidor = createServer();

servidor.once('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `ERRO: a porta ${porta} (${nome}) esta ocupada.`,
        '',
        'Esta porta e fixa por decisao registrada -- CLAUDE.md, Regras de',
        'trabalho. Trocar de porta automaticamente deixaria dois processos',
        'servindo ao mesmo tempo, com o operador falando com um e lendo o log',
        'do outro.',
        '',
        'Para resolver, escolha uma:',
        `  - encerre o processo que ocupa a ${porta};`,
        '  - se a colisao for permanente nesta maquina, isso e decisao a',
        '    registrar com o PI, nao ajuste silencioso.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.error(`ERRO ao verificar a porta ${porta}: ${erro.message}`);
  process.exit(1);
});

servidor.once('listening', () => {
  servidor.close(() => process.exit(0));
});

servidor.listen(porta, '127.0.0.1');
