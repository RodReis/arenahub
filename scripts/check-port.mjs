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

/**
 * Testa o bind numa interface. Resolve para o codigo do erro, ou null se a
 * porta estiver livre ali.
 *
 * Precisa ser feito nas DUAS interfaces. Testar so 127.0.0.1 nao detecta
 * processo escutando em 0.0.0.0 -- o bind no loopback tem sucesso mesmo com
 * a porta ocupada. E esse e justamente o caso comum: Docker e a maioria dos
 * servicos bindam 0.0.0.0 por padrao. Guarda que so olha o loopback nao
 * guarda nada.
 */
function testarBind(host) {
  return new Promise((resolve) => {
    const servidor = createServer();
    servidor.once('error', (erro) => resolve(erro.code ?? 'ERRO'));
    servidor.once('listening', () => servidor.close(() => resolve(null)));
    servidor.listen(porta, host);
  });
}

const resultados = await Promise.all([testarBind('127.0.0.1'), testarBind('0.0.0.0')]);
const ocupada = resultados.some((codigo) => codigo === 'EADDRINUSE');
const outroErro = resultados.find((codigo) => codigo && codigo !== 'EADDRINUSE');

if (ocupada) {
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

if (outroErro) {
  console.error(`ERRO ao verificar a porta ${porta}: ${outroErro}`);
  process.exit(1);
}

process.exit(0);
