#!/usr/bin/env node
/**
 * Guarda do contrato de Server Action: arquivo `'use server'` so exporta
 * FUNCAO ASYNC.
 *
 *   node scripts/check-use-server.mjs
 *
 * POR QUE ELA EXISTE
 * ------------------
 * Nao e hipotese, e o defeito e de 01/09/2026 (issue #241): exportei
 * `SITUACAO_COM_MOTIVO = new Set([...])` de `app/actions/students.ts`, que
 * tem `'use server'` no topo. A ficha do aluno passou a responder **500** ao
 * submeter, com
 *
 *     A "use server" file can only export async functions, found object
 *
 * E O QUE NENHUMA GUARDA PEGOU
 * ----------------------------
 * `typecheck` limpo, `lint` verde, **454 testes de tela passando**, e
 * `pnpm build` **COMPLETA COM SUCESSO** -- medido plantando o canario de
 * novo: "Compiled successfully", exit 0, com o export ilegal presente. O erro
 * so existe no runtime do React Server Components, entao ele chega inteiro na
 * mao de quem usa a tela.
 *
 * Regra que so o navegador verifica e regra que o CI nao verifica.
 *
 * O QUE ELA PEGA
 * --------------
 * Em arquivo com `'use server'` no topo: `export const/let/var`, `export
 * class`, `export function` NAO-async, e `export { ... }` de binding que nao
 * seja funcao async declarada no proprio arquivo.
 *
 * O QUE ELA NAO PEGA, DE PROPOSITO
 * --------------------------------
 * - `export type` e `export interface`: apagados na compilacao, nao chegam ao
 *   runtime. O `EstadoDoDispositivo` desta mesma entrega e um deles.
 * - `'use server'` DENTRO de funcao (a outra forma da diretiva): ali o
 *   arquivo nao e um modulo de action, e a restricao nao vale.
 *
 * COMO CORRIGIR quando ela acusar
 * -------------------------------
 * Constante compartilhada entre action e componente mora num modulo puro
 * (`src/**`); a action IMPORTA de la e nao reexporta. Foi assim que a #241
 * ficou -- e a lista ja existia em `src/students/formatar.ts`, o que fazia da
 * exportacao ilegal tambem uma duplicata.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * A diretiva vale so quando e a PRIMEIRA instrucao do arquivo -- `'use
 * server'` no meio do codigo e uma string solta, e nao torna o modulo uma
 * action. Por isso a checagem olha o inicio, e nao um `includes()`.
 */
function ehModuloDeAction(fonte) {
  const semComentarios = fonte
    .replace(/^﻿/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trimStart();

  return /^(['"])use server\1\s*;?/.test(semComentarios);
}

/** Exportacoes que o runtime do RSC recusa. */
const PROIBIDOS = [
  {
    // `export const X`, `export let`, `export var` -- o caso da #241.
    padrao: /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm,
    diga: (nome) => `export const/let/var \`${nome}\``,
  },
  {
    padrao: /^\s*export\s+class\s+([A-Za-z0-9_$]+)/gm,
    diga: (nome) => `export class \`${nome}\``,
  },
  {
    // `export function` SEM `async`. O `(?!async)` e o ponto: funcao async
    // exportada e exatamente o que o arquivo deve conter.
    padrao: /^\s*export\s+function\s+([A-Za-z0-9_$]+)/gm,
    diga: (nome) => `export function \`${nome}\` (sem \`async\`)`,
  },
  {
    // `export default` de qualquer coisa: o runtime aplica a mesma regra, e
    // action nomeada e a convencao daqui.
    padrao: /^\s*export\s+default\s+(?!async\s+function)/gm,
    diga: () => 'export default (que nao seja `async function`)',
  },
];

const arquivos = globSync('apps/*/app/**/*.{ts,tsx}', { cwd: RAIZ })
  .map((caminho) => join(RAIZ, caminho))
  .filter((caminho) => !caminho.includes('node_modules'));

const achados = [];

for (const caminho of arquivos) {
  const fonte = readFileSync(caminho, 'utf8');

  if (!ehModuloDeAction(fonte)) continue;

  for (const { padrao, diga } of PROIBIDOS) {
    for (const casamento of fonte.matchAll(padrao)) {
      const linha = fonte.slice(0, casamento.index).split('\n').length;

      achados.push({
        arquivo: relative(RAIZ, caminho).replace(/\\/g, '/'),
        linha,
        o_que: diga(casamento[1] ?? ''),
      });
    }
  }
}

if (achados.length > 0) {
  console.error('');
  console.error('ERRO: arquivo `\'use server\'` so pode exportar FUNCAO ASYNC.');
  console.error('');

  for (const { arquivo, linha, o_que } of achados) {
    console.error(`  ${arquivo}:${linha} -- ${o_que}`);
  }

  console.error('');
  console.error('O runtime do React Server Components recusa isso com 500:');
  console.error('  A "use server" file can only export async functions, found object');
  console.error('');
  console.error('E NADA MAIS PEGA: typecheck, lint, testes e `pnpm build` passam');
  console.error('todos -- medido na issue #241. O erro chega na tela de quem usa.');
  console.error('');
  console.error('Correcao: mova a constante para um modulo puro (`src/**`) e');
  console.error('IMPORTE dela na action, sem reexportar. `export type` e');
  console.error('`export interface` continuam permitidos -- somem na compilacao.');
  console.error('');
  process.exit(1);
}

console.log(`[check-use-server] ok -- nenhum export invalido em arquivo 'use server'.`);
