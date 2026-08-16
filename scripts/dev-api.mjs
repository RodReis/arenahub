#!/usr/bin/env node
/**
 * `dev` da API: compila com `tsc --watch` e reinicia o processo a cada build.
 *
 * POR QUE NAO `tsx watch`, que seria uma linha so:
 *
 * O `tsx` usa esbuild, e o esbuild NAO emite `design:paramtypes`. O Nest
 * depende desse metadado para resolver dependencia por tipo no construtor --
 * sem ele, `PrismaService` chega `undefined` ao `MfaService` e a API morre no
 * arranque com `UndefinedDependencyException`.
 *
 * O sintoma e cruel: `build`, `lint`, `typecheck` e todos os testes passam.
 * O `build` usa `tsc`, que emite o metadado; o `ts-jest` tambem. So o `dev`
 * quebrava -- e o CI nunca roda `dev`. O bug sobreviveu da F6 ate alguem
 * tentar abrir a aplicacao no navegador.
 *
 * Alternativas descartadas:
 *
 *   - `@swc/cli` com `swc` -- emite o metadado, mas e dependencia nova para
 *     resolver o que o `tsc` que ja esta aqui resolve;
 *   - `nest start --watch` -- exige `@nestjs/cli`, idem;
 *   - `ts-node` -- mais lento que `tsc --watch` incremental.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ_DA_API = process.cwd();
const ENTRADA = join(RAIZ_DA_API, 'dist', 'main.js');

/** Processo da API. Morre e renasce a cada compilacao bem-sucedida. */
let api;

function reiniciarApi() {
  if (api) {
    api.kill();
    api = undefined;
  }

  if (!existsSync(ENTRADA)) return;

  api = spawn(process.execPath, [ENTRADA], {
    cwd: RAIZ_DA_API,
    stdio: 'inherit',
  });
}

const tsc = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { cwd: RAIZ_DA_API, shell: process.platform === 'win32' },
);

tsc.stdout.setEncoding('utf8');

tsc.stdout.on('data', (texto) => {
  process.stdout.write(texto);

  // O `tsc --watch` anuncia o fim de cada ciclo. Reiniciar antes disso
  // subiria a API com `dist/` pela metade.
  if (/Found 0 errors/.test(texto)) reiniciarApi();
});

tsc.stderr?.pipe(process.stderr);

/** Encerramento gracioso: sem isto, o `tsc` fica orfao no Ctrl+C. */
function encerrar() {
  api?.kill();
  tsc.kill();
  process.exit(0);
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
