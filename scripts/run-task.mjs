#!/usr/bin/env node
/**
 * Roda uma task do Turbo e FALHA se nenhum workspace a executou.
 *
 * Por que isto existe: `turbo run test` num repo onde nenhum workspace
 * declara `test` imprime "No tasks were executed" e sai com codigo 0. O
 * comando mente -- e quem le a mentira e o CI, que no nosso processo
 * substitui o aceite humano no merge (CLAUDE.md -> Ciclo de vida de uma
 * fatia, passo 3). Comando que passa sem executar nada e pior que comando
 * ausente: o ausente quebra na hora, o mentiroso quebra a confianca.
 *
 * O Turbo 2.10 nao tem flag para isso -- verificado em `turbo run --help`.
 *
 * Uso: node scripts/run-task.mjs <task> [args do turbo...]
 */
import { spawnSync } from 'node:child_process';

// Binario local resolvido pelo pnpm. Em Windows o wrapper e .cmd.
const TURBO = process.platform === 'win32' ? 'node_modules\\.bin\\turbo.cmd' : 'node_modules/.bin/turbo';

const [task, ...rest] = process.argv.slice(2);

if (!task) {
  console.error('uso: node scripts/run-task.mjs <task> [args...]');
  process.exit(2);
}

const args = ['run', task, ...rest];

/** Falha com instrucao, em vez de sair 0 fingindo sucesso. */
function falhaPorTaskAusente() {
  console.error(
    [
      '',
      `ERRO: \`pnpm ${task}\` nao executou nada e por isso falhou.`,
      '',
      `Nenhum workspace declara o script "${task}" no seu package.json.`,
      'Sair com 0 aqui seria mentir para o CI, que e o que autoriza o merge.',
      '',
      'Para resolver, escolha uma:',
      `  - adicione "${task}" aos scripts do workspace que precisa dele;`,
      `  - se a task nao se aplica a nenhum workspace ainda, isso e esperado`,
      '    durante o bootstrap -- ver docs/DEVELOPMENT.md secao 4.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// `dev` e persistente: entrega o terminal e so volta no Ctrl+C, entao nao da
// para inspecionar a saida depois. O guarda tem de vir ANTES -- senao `pnpm
// dev` num repo sem app sai com 0 imediatamente e mente do mesmo jeito.
const PERSISTENT = new Set(['dev']);

if (PERSISTENT.has(task)) {
  // Binario local, nao `pnpm turbo`: o pnpm escreve avisos no stdout e
  // contamina o JSON.
  const inspecao = spawnSync(TURBO, ['run', task, '--dry=json'], {
    encoding: 'utf8',
    shell: true,
  });

  if (inspecao.status === 0) {
    try {
      const plano = JSON.parse(inspecao.stdout ?? '{}');
      // O turbo lista a task mesmo quando o workspace nao a declara --
      // nesse caso `command` vem como "<NONEXISTENT>". Contar o array nao
      // basta; o que importa e ter ao menos um comando de verdade.
      const executaveis = (plano.tasks ?? []).filter(
        (t) => t.command && t.command !== '<NONEXISTENT>',
      );
      if (executaveis.length === 0) {
        falhaPorTaskAusente();
      }
    } catch {
      // Se o plano nao for legivel, seguir e deixar o turbo decidir e mais
      // seguro do que falhar por causa do proprio guarda.
    }
  }

  process.exit(spawnSync(TURBO, args, { stdio: 'inherit', shell: true }).status ?? 1);
}

const result = spawnSync(TURBO, args, { encoding: 'utf8', shell: true });

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// "Tasks:    0 successful, 0 total" -- nenhum workspace declarou a task.
const nenhumaTaskRodou = /Tasks:\s+0 successful, 0 total/.test(output);

if (nenhumaTaskRodou) {
  falhaPorTaskAusente();
}

process.exit(0);
