#!/usr/bin/env node
/**
 * Self-check do gerador de relatorio (`docs/TESTING.md` §5).
 *
 *   node scripts/test-report.selfcheck.mjs
 *
 * "Gerador de relatorio sem teste e a forma mais elegante de mentir com
 * numero." O que este arquivo garante e uma coisa so, e a mais importante:
 * QUE O GERADOR CONTA O QUE EXISTE -- nao o que gostariamos que existisse.
 *
 * O metodo e criar arquivo de teste falso num repositorio Git temporario,
 * rodar o gerador la dentro e conferir se o numero mudou. Se o gerador
 * passar a inventar linha, estimar ou herdar numero antigo, estes casos
 * quebram.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const GERADOR = join(RAIZ, 'scripts', 'test-report.mjs');

/** Monta um repositorio Git descartavel com os arquivos pedidos. */
function repositorioFalso(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-selfcheck-'));

  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'selfcheck@local'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'selfcheck'], { cwd: dir });

  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(GERADOR, join(dir, 'scripts', 'test-report.mjs'));

  for (const caminho of arquivos) {
    const destino = join(dir, caminho);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, '// arquivo de teste falso do self-check\n');
  }

  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'selfcheck'], { cwd: dir });

  return dir;
}

function gerarEm(dir) {
  const r = spawnSync('node', [join(dir, 'scripts', 'test-report.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`gerador falhou: ${r.stderr ?? ''}`);
  }
  return readFileSync(join(dir, 'reports', 'TESTS.md'), 'utf8');
}

/** Le o numero da coluna "arquivos" da linha de um nivel. */
function contagem(relatorio, nivel) {
  const linha = relatorio.split('\n').find((l) => l.startsWith(`| ${nivel} |`));
  assert.ok(linha, `o relatorio nao tem linha para o nivel "${nivel}"`);
  const valor = Number(linha.split('|').at(-2)?.trim());
  assert.ok(Number.isInteger(valor), `contagem ilegivel para "${nivel}": ${linha}`);
  return valor;
}

const casos = [];

casos.push([
  'sem teste algum, conta zero e diz que nao ha cobertura',
  () => {
    const dir = repositorioFalso([]);
    try {
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'unitário'), 0);
      assert.match(r, /Nenhum teste de domínio existe ainda/);
      assert.match(r, /Cobertura de regra de domínio: \*\*n\/a\*\*/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'conta o arquivo que existe, por sufixo',
  () => {
    const dir = repositorioFalso([
      'src/a.spec.ts',
      'src/b.spec.ts',
      'src/c.int-spec.ts',
      'src/d.e2e-spec.ts',
    ]);
    try {
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'unitário'), 2);
      assert.equal(contagem(r, 'integração'), 1);
      assert.equal(contagem(r, 'e2e'), 1);
      assert.equal(contagem(r, 'contrato'), 0);
      assert.doesNotMatch(r, /Nenhum teste de domínio existe ainda/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'nao confunde nivel: .int-spec.ts nao entra como unitário',
  () => {
    // `.int-spec.ts` tambem termina em `-spec.ts`; um gerador desatento
    // contaria o mesmo arquivo duas vezes ou no balde errado.
    const dir = repositorioFalso(['src/x.int-spec.ts']);
    try {
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'integração'), 1);
      assert.equal(contagem(r, 'unitário'), 0, '.int-spec.ts vazou para o nivel unitário');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'conta teste de componente React: .spec.tsx entra como unitário (regressao #111)',
  () => {
    // `"Button.spec.tsx".endsWith(".spec.ts")` e `false` -- termina em `x`.
    // Enquanto o nivel teve UM sufixo, os 17 testes de componente do design
    // system nao entravam em balde nenhum e o total mentia para menos.
    const dir = repositorioFalso(['src/Button.spec.tsx', 'src/util.spec.ts']);
    try {
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'unitário'), 2, '.spec.tsx nao foi contado como unitário');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'nao confunde nivel em .tsx: .int-spec.tsx nao entra como unitário',
  () => {
    // A precedencia vem do ponto literal, nao da ordem do array -- e ela
    // precisa valer nos dois sufixos, nao so no `.ts`.
    const dir = repositorioFalso(['src/x.int-spec.tsx']);
    try {
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'integração'), 1);
      assert.equal(contagem(r, 'unitário'), 0, '.int-spec.tsx vazou para o nivel unitário');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'ignora arquivo nao rastreado pelo Git',
  () => {
    const dir = repositorioFalso(['src/a.spec.ts']);
    try {
      // Escrito depois do commit: existe no disco, nao no indice.
      writeFileSync(join(dir, 'src', 'fantasma.spec.ts'), '// nao commitado\n');
      const r = gerarEm(dir);
      assert.equal(contagem(r, 'unitário'), 1, 'contou arquivo fora do indice do Git');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  'o conteudo nao muda entre commits (regressao: o SHA dentro do arquivo tornava a guarda impossivel)',
  () => {
    const dir = repositorioFalso(['src/a.spec.ts']);
    try {
      const primeiro = gerarEm(dir);

      // Commit novo, SHA novo -- e nada mais mudou no repositorio.
      writeFileSync(join(dir, 'qualquer.txt'), 'muda o SHA\n');
      spawnSync('git', ['add', '-A'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '-m', 'outro commit'], { cwd: dir });

      assert.equal(
        gerarEm(dir),
        primeiro,
        'o relatorio mudou sem que teste algum mudasse -- --check nunca poderia passar',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  '--check falha quando o relatorio commitado diverge',
  () => {
    const dir = repositorioFalso(['src/a.spec.ts']);
    try {
      gerarEm(dir);
      // Adultera o relatorio: e o cenario que a guarda existe para pegar.
      const alvo = join(dir, 'reports', 'TESTS.md');
      writeFileSync(alvo, readFileSync(alvo, 'utf8').replace('| 1 |', '| 999 |'));

      const r = spawnSync('node', [join(dir, 'scripts', 'test-report.mjs'), '--check'], {
        cwd: dir,
        encoding: 'utf8',
      });
      assert.equal(r.status, 1, '--check aceitou relatorio adulterado');
      assert.match(r.stderr, /divergiu/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

casos.push([
  '--check falha quando o relatorio nao existe',
  () => {
    const dir = repositorioFalso(['src/a.spec.ts']);
    try {
      const r = spawnSync('node', [join(dir, 'scripts', 'test-report.mjs'), '--check'], {
        cwd: dir,
        encoding: 'utf8',
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /nao existe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
]);

let falhas = 0;

for (const [nome, caso] of casos) {
  try {
    caso();
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`          ${erro.message}`);
  }
}

console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas === 0 ? 0 : 1);
