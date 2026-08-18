#!/usr/bin/env node
/**
 * Prepara o banco dedicado a suite E2E -- card [INFRA], issue #101.
 *
 * A suite E2E CRIA aluno, plano e dispositivo e NAO limpa o que criou (os
 * testes de integracao limpam com `deleteMany`; estes, nao). Quando ela
 * apontava para o `DATABASE_URL` do desenvolvimento, cada execucao deixava
 * residuo com epoch no nome (`Caminho Biometria 1787060177858`) e a tela de
 * Alunos exibia o rastro da propria suite em vez do produto.
 *
 * Este script executa, em ordem:
 *
 *   1. `migrate reset --force` -- derruba o banco, recria e reaplica TODAS as
 *      migrations;
 *   2. `seed`                  -- tenant, dono e catalogo de planos.
 *
 * O reset e o ponto: em vez de limpar no fim (que nao roda quando a suite
 * quebra no meio), o banco nasce vazio a cada execucao. Suite interrompida por
 * `Ctrl+C` nao deixa residuo para a proxima, porque a proxima nao herda nada.
 *
 * O seed vem separado porque no Prisma 7 o `migrate reset` NAO semeia: o
 * `executeSeedCommand` so e chamado pelo `db seed`. Documentacao mais antiga
 * afirma o contrario; o codigo do comando e que vale.
 *
 * PROTECAO: o script RECUSA rodar contra o banco de desenvolvimento. O nome do
 * banco alvo precisa terminar em `_e2e`. Um `E2E_DATABASE_URL` mal copiado
 * apontando para `arenahub` derrubaria o ambiente inteiro de quem rodou -- e
 * essa e a classe de erro que um script destrutivo tem que tratar antes de
 * qualquer outra coisa.
 */
import { spawnSync } from 'node:child_process';

const RAIZ = process.cwd();

/**
 * URL do banco de E2E. SEM valor padrao, de proposito.
 *
 * Um default embutido carrega a porta da maquina de quem o escreveu: aqui o
 * Postgres do projeto atende em 5442, e a 5432 e de OUTRO projeto na mesma
 * maquina. Adivinhar apontaria um comando destrutivo para o banco errado.
 * Falta a variavel, o script para e diz o que falta.
 */
const URL_E2E = process.env['E2E_DATABASE_URL'];

if (!URL_E2E) {
  throw new Error(
    'E2E_DATABASE_URL nao definida. Copie a linha do `.env.example` para o seu ' +
      '`.env` e ajuste a porta para a do seu Postgres (veja POSTGRES_PORT).',
  );
}

/** Extrai o nome do banco e recusa qualquer alvo que nao seja de E2E. */
function nomeDoBancoAlvo(url) {
  const nome = new URL(url).pathname.replace(/^\//, '');

  if (!nome) {
    throw new Error(`E2E_DATABASE_URL sem nome de banco: ${url}`);
  }

  // A GUARDA. Sem ela, um copiar-e-colar transforma este script numa arma
  // apontada para o banco de desenvolvimento de quem o rodou.
  if (!nome.endsWith('_e2e')) {
    throw new Error(
      `Recusado: o banco de E2E precisa terminar em "_e2e", e veio "${nome}".\n` +
        'Este script APAGA o banco alvo. Apontar para o de desenvolvimento\n' +
        'destruiria o ambiente inteiro.',
    );
  }

  return nome;
}

/**
 * Roda um script do pacote `@arenahub/database` contra o banco de E2E.
 *
 * Tudo passa pelo Prisma, e nao por `docker exec ... psql`, por dois motivos:
 * o CI nao tem container chamado `arenahub-postgres` (la o Postgres e service
 * container), e o `psql` receberia o SQL por linha de comando -- que no
 * Windows o cmd.exe reparte em palavras soltas, fazendo o comando chegar como
 * so `DROP` e morrer com `syntax error at end of input`. O Prisma fala o
 * protocolo do Postgres direto: mesma chamada local e no CI.
 *
 * Nota para agente de IA: o Prisma 7 recusa `migrate reset` quando detecta a
 * variavel `AI_AGENT` no ambiente, e pede consentimento humano explicito em
 * `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. O bloqueio nao atinge pessoa
 * nem CI (nenhum dos dois define `AI_AGENT`), entao NAO se embute consentimento
 * aqui: seria burlar uma guarda que existe justamente para o caso em que o
 * alvo nao e um banco descartavel.
 */
function rodarNoBanco(script) {
  const resultado = spawnSync('pnpm', ['--filter', '@arenahub/database', ...script], {
    cwd: RAIZ,
    stdio: 'inherit',
    // `shell: true` no Windows porque `pnpm` la e um `.cmd`, que o `spawn` nao
    // executa direto. Os argumentos sao literais deste arquivo, nunca entrada
    // de usuario.
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: URL_E2E },
  });

  return resultado.status ?? 1;
}

function main() {
  const nome = nomeDoBancoAlvo(URL_E2E);

  console.log(`\nArenaHub -- preparando banco de E2E "${nome}".\n`);

  const passos = [
    {
      titulo: `Recriar "${nome}" e aplicar migrations`,
      rodar: () => rodarNoBanco(['exec', 'prisma', 'migrate', 'reset', '--force']),
    },
    { titulo: 'Seed', rodar: () => rodarNoBanco(['seed']) },
  ];

  for (const passo of passos) {
    console.log(`\n> ${passo.titulo}`);

    const status = passo.rodar();

    if (status !== 0) {
      console.error(`\nERRO: "${passo.titulo}" falhou com status ${String(status)}.`);
      process.exit(status);
    }
  }

  console.log('\nBanco de E2E pronto. O de desenvolvimento nao foi tocado.\n');
}

try {
  main();
} catch (erro) {
  console.error(`\nERRO: ${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(2);
}
