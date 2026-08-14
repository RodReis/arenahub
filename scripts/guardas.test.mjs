#!/usr/bin/env node
/**
 * Teste dos dois guardas. Sem framework -- eles nascem antes do runner de
 * teste existir (card #44 vem antes do #46/#47).
 *
 *   node scripts/guardas.test.mjs
 *
 * Os quatro casos abaixo nao sao hipoteticos: os dois primeiros de cada
 * guarda passaram batido na primeira versao e so apareceram na revisao.
 * Existem aqui para nao voltarem.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const PORTA_LIVRE = 39901;
const PORTA_OCUPADA = 39902;

function rodarGuardaDeTask(task, env = {}) {
  return spawnSync('node', ['scripts/run-task.mjs', task], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function rodarGuardaDePorta(porta) {
  return spawnSync('node', ['scripts/check-port.mjs', String(porta), 'teste'], {
    encoding: 'utf8',
  });
}

function abrirListener(host, porta) {
  return new Promise((resolve) => {
    const servidor = createServer();
    servidor.listen(porta, host, () => resolve(servidor));
  });
}

const casos = [];

// --- run-task.mjs ----------------------------------------------------------

casos.push([
  'task que nenhum workspace declara falha com exit 1',
  () => {
    const r = rodarGuardaDeTask('test');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nao executou nada/);
  },
]);

casos.push([
  'task ausente falha TAMBEM sob FORCE_COLOR=1 (regressao: a saida colorida quebrava a deteccao por regex)',
  () => {
    const r = rodarGuardaDeTask('test', { FORCE_COLOR: '1' });
    assert.equal(r.status, 1, 'guarda deixou passar sob ANSI -- e o cenario do CI');
  },
]);

casos.push([
  'task que existe de verdade continua passando',
  () => {
    assert.equal(rodarGuardaDeTask('lint').status, 0);
  },
]);

// --- check-port.mjs --------------------------------------------------------

casos.push([
  'porta livre passa',
  () => {
    assert.equal(rodarGuardaDePorta(PORTA_LIVRE).status, 0);
  },
]);

casos.push([
  'porta ocupada em 0.0.0.0 e detectada (regressao: so testar 127.0.0.1 deixava passar)',
  async () => {
    const servidor = await abrirListener('0.0.0.0', PORTA_OCUPADA);
    try {
      const r = rodarGuardaDePorta(PORTA_OCUPADA);
      assert.equal(r.status, 1, 'guarda nao viu listener em 0.0.0.0 -- o caso comum do Docker');
      assert.match(r.stderr, /esta ocupada/);
    } finally {
      servidor.close();
    }
  },
]);

casos.push([
  'porta ocupada em 127.0.0.1 e detectada',
  async () => {
    const servidor = await abrirListener('127.0.0.1', PORTA_OCUPADA);
    try {
      assert.equal(rodarGuardaDePorta(PORTA_OCUPADA).status, 1);
    } finally {
      servidor.close();
    }
  },
]);

// --- execucao --------------------------------------------------------------

let falhas = 0;

for (const [nome, caso] of casos) {
  try {
    await caso();
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`          ${erro.message}`);
  }
}

console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas === 0 ? 0 : 1);
