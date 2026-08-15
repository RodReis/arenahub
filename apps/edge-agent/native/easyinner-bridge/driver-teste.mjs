// Driver manual de teste da ponte EasyInner. Fala com o .exe pela ponte real.
// Uso: node driver-teste.mjs <exe> <arquivo-comandos>
// O arquivo tem um comando JSON por linha (evita o inferno de aspas do shell).
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const EXE = resolve(process.argv[2]);
const comandos = readFileSync(resolve(process.argv[3]), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const proc = spawn(EXE, [], { stdio: 'pipe' });
proc.stdout.setEncoding('utf8');

let buffer = '';
const fila = [];
proc.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const linha = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (linha) {
      const r = fila.shift();
      if (r) r(linha);
    }
  }
});

function enviar(json, timeoutMs = 8000) {
  return new Promise((res) => {
    const t = setTimeout(() => res('(TIMEOUT sem resposta)'), timeoutMs);
    fila.push((linha) => {
      clearTimeout(t);
      res(linha);
    });
    proc.stdin.write(json + '\n');
  });
}

const t0 = process.hrtime.bigint();
function ms() {
  return Number((process.hrtime.bigint() - t0) / 1000000n);
}
const dorme = (m) => new Promise((r) => setTimeout(r, m));
for (const cmd of comandos) {
  const resp = await enviar(cmd, 6000);
  console.log(`[${ms()}ms] >> ${cmd}`);
  console.log(`[${ms()}ms] << ${resp}`);
  // Apos conectar, da tempo da catraca discar de volta para a ponte.
  if (cmd.includes('"conectar"')) await dorme(4000);
}

proc.stdin.end();
proc.kill();
process.exit(0);
