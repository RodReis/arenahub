#!/usr/bin/env node
/**
 * Sobe o ambiente de desenvolvimento inteiro, do zero, num comando so.
 *
 * `pnpm setup` executa, em ordem:
 *
 *   1. .env            -- copia de .env.example se ainda nao existir;
 *   2. dependencias    -- pnpm install --frozen-lockfile;
 *   3. containers      -- Postgres, Redis e MinIO, com --wait;
 *   4. client Prisma   -- generate;
 *   5. migrations      -- migrate deploy (nao interativo);
 *   6. build           -- packages que a API importa compilados;
 *   7. seed            -- tenant, dono e permissoes de bancada.
 *
 * A ORDEM NAO E ARBITRARIA e cada passo depende do anterior: migration sem
 * container falha por conexao recusada; seed sem migration falha por tabela
 * ausente; a API nao sobe sem o client gerado.
 *
 * IDEMPOTENTE: rodar duas vezes nao quebra nada. O `.env` existente e
 * preservado (nunca sobrescrito -- ele pode ter credencial de bancada), a
 * migration ja aplicada e ignorada, e o seed usa `upsert`.
 *
 * Este script NAO existe para producao. La as variaveis vem de secret
 * manager e a migration roda no deploy, nao numa conveniencia de terminal.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();

/** Passo do setup. `opcional` nao derruba o script quando falha. */
const PASSOS = [
  {
    titulo: 'Arquivo .env',
    executar: () => {
      const destino = join(RAIZ, '.env');

      if (existsSync(destino)) {
        console.log('  .env ja existe -- preservado.');
        return 0;
      }

      copyFileSync(join(RAIZ, '.env.example'), destino);
      console.log('  .env criado a partir de .env.example.');

      return 0;
    },
  },
  {
    titulo: 'Dependencias',
    comando: 'pnpm',
    // `--frozen-lockfile`: instala exatamente o que o lockfile diz. Sem a
    // flag, uma resolucao diferente entra em silencio e a maquina de quem
    // rodou o setup deixa de ser igual a do CI.
    args: ['install', '--frozen-lockfile'],
  },
  {
    titulo: 'Containers (Postgres, Redis, MinIO)',
    comando: 'pnpm',
    // `docker:up` ja usa `--wait`: o comando so volta quando os healthchecks
    // passam. Sem isso, a migration seguinte tentaria conectar num Postgres
    // que ainda esta subindo.
    args: ['docker:up'],
  },
  {
    titulo: 'Client Prisma',
    comando: 'pnpm',
    args: ['--filter', '@arenahub/database', 'generate'],
  },
  {
    titulo: 'Migrations',
    comando: 'pnpm',
    // `deploy`, e nao `dev`: `migrate dev` e interativo e pode propor
    // resetar o banco. Num script de setup isso seria uma pergunta que
    // ninguem esta lendo, ou pior, um reset silencioso.
    args: ['--filter', '@arenahub/database', 'migrate:deploy'],
  },
  {
    titulo: 'Build dos pacotes',
    comando: 'pnpm',
    args: ['build'],
  },
  {
    titulo: 'Seed de desenvolvimento',
    comando: 'pnpm',
    args: ['--filter', '@arenahub/database', 'seed'],
  },
];

function executarComando(comando, args) {
  // `shell: true` no Windows porque `pnpm` la e um `.cmd`, que o `spawn` nao
  // executa direto. O Node 24 avisa que passar args com shell pode ser
  // inseguro -- vale para argumento vindo de entrada externa; aqui todos os
  // comandos sao literais deste arquivo, nenhum vem do usuario.
  const resultado = spawnSync(comando, args, {
    cwd: RAIZ,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return resultado.status ?? 1;
}

function main() {
  console.log('\nArenaHub -- preparando ambiente de desenvolvimento local.\n');

  if (!existsSync(join(RAIZ, '.env.example'))) {
    console.error('ERRO: rode este comando na raiz do repositorio.');
    process.exit(2);
  }

  for (const [indice, passo] of PASSOS.entries()) {
    console.log(`\n[${indice + 1}/${PASSOS.length}] ${passo.titulo}`);

    const codigo = passo.executar
      ? passo.executar()
      : executarComando(passo.comando, passo.args);

    if (codigo !== 0) {
      console.error(`\nERRO no passo "${passo.titulo}".`);
      console.error('\nOs passos seguintes dependem deste, entao o setup para aqui.');

      // Docker e a causa mais comum, e a mensagem crua do compose nao diz
      // isso de forma util para quem esta comecando.
      if (passo.titulo.startsWith('Containers')) {
        console.error('Verifique se o Docker Desktop esta rodando.');
      }

      process.exit(codigo);
    }
  }

  console.log(
    [
      '',
      '',
      'Ambiente pronto.',
      '',
      '  pnpm dev                    sobe API (3344), admin-web (3000) e totem (3210)',
      '  pnpm test                   testes de unidade',
      '  pnpm test:integration       testes que usam Postgres',
      '',
      'Login de desenvolvimento (vem do seed, so vale localmente):',
      '  dono@arena-positiva.test / senha-de-bancada-arenahub',
      '',
    ].join('\n'),
  );
}

main();
