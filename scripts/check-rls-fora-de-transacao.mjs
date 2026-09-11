#!/usr/bin/env node
/**
 * Recusa acesso a tabela com politica RLS FORA de transacao com contexto.
 *
 *   node scripts/check-rls-fora-de-transacao.mjs [--arquivo <caminho>]
 *
 * POR QUE ESTA GUARDA EXISTE. A politica da F66 (ADR-054) so e respeitada
 * quando a transacao roda `set_config`, e o `PrismaService` so o faz dentro
 * de `$transaction` interativo. Uma leitura solta -- `this.db.student.
 * findMany(...)` -- corre fora disso, e sob o role restrito a politica
 * devolve ZERO LINHAS em silencio: nenhum erro, nenhum log, indistinguivel
 * de "nao ha dados".
 *
 * O defeito ja voltou tres vezes (#289, #302, #306) porque nada no
 * repositorio o detectava: o TypeScript nao ve diferenca entre `this.db.x` e
 * `tx.x`, e o teste passa porque o banco de teste roda sob o dono, que
 * ignora RLS. Revisao humana tambem nao pegou -- as tres vezes.
 *
 * A guarda e ESTATICA de proposito. Provar isto em teste de integracao
 * exigiria o role restrito ligado em toda suite, e cada ponto novo teria de
 * ganhar um teste proprio -- que e exatamente o que ninguem lembra de
 * escrever. Aqui, o ponto novo falha o CI no minuto em que nasce.
 *
 * O QUE ELA NAO PEGA. Modelo cuja raiz nao tem politica mas que traz
 * `student` por `include`/`select` aninhado (`tx.subscription.findMany({
 * include: { student: ... } })`). Casar isso exigiria entender a arvore do
 * objeto, e um regex que tentasse erraria nos dois sentidos. Esses pontos
 * ficam por conta da revisao, com a nota de `comTenant` no proprio codigo.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Os modelos com politica, no nome que o client do Prisma usa.
 *
 * Espelha `MODELOS_COM_RLS` do `prisma.service.ts`. Quando a F67 puser
 * politica em todas as tabelas com `tenant_id`, as duas listas crescem
 * juntas -- e a duplicacao e proposital: importar TypeScript de dentro de um
 * script `.mjs` exigiria compilar o pacote so para rodar a guarda.
 */
const MODELOS = ['student', 'auditLog'];

/**
 * `this.db.student.` / `this.prisma.auditLog.` e afins.
 *
 * Casa o ACESSO PELO CAMPO do servico injetado, que e a unica forma que
 * corre fora de transacao. `tx.student.` nao casa, e e justamente o certo:
 * ali o `set_config` ja rodou.
 */
const PADRAO = new RegExp(`\\bthis\\.\\w+\\.(${MODELOS.join('|')})\\.\\w+\\(`, 'g');

/** Arquivos de origem da API, sem teste nem gerado. */
function arquivosDaApi() {
  const saida = execFileSync(
    'git',
    ['ls-files', 'apps/api/src/**/*.ts', 'apps/edge-agent/src/**/*.ts'],
    { encoding: 'utf8' },
  );

  return saida
    .split('\n')
    .filter(Boolean)
    .filter((caminho) => !/\.(spec|int-spec|e2e-spec)\.ts$/.test(caminho));
}

/**
 * O `prisma.service.ts` e a unica excecao legitima: e ele que DEFINE
 * `comTenant`, e o proprio corpo do metodo toca o client.
 */
const ISENTOS = new Set(['apps/api/src/persistence/prisma.service.ts']);

function violacoes(caminho) {
  const conteudo = readFileSync(caminho, 'utf8');
  const encontradas = [];

  for (const achado of conteudo.matchAll(PADRAO)) {
    const linha = conteudo.slice(0, achado.index).split('\n').length;
    encontradas.push({ linha, trecho: achado[0] });
  }

  return encontradas;
}

function main() {
  const argumentoDeArquivo = process.argv.indexOf('--arquivo');

  const alvos =
    argumentoDeArquivo === -1
      ? arquivosDaApi()
      : [relative(process.cwd(), resolve(process.argv[argumentoDeArquivo + 1]))];

  const problemas = [];

  for (const caminho of alvos) {
    const normalizado = caminho.split('\\').join('/');

    if (ISENTOS.has(normalizado)) continue;

    for (const { linha, trecho } of violacoes(caminho)) {
      problemas.push(`${normalizado}:${linha}  ${trecho}`);
    }
  }

  if (problemas.length === 0) {
    console.log(`[rls] ok -- ${alvos.length} arquivos, nenhum acesso solto a tabela com politica`);
    return;
  }

  console.error(
    `\n[rls] ${problemas.length} acesso(s) a tabela com politica RLS FORA de transacao com contexto:\n`,
  );

  for (const problema of problemas) console.error(`  ${problema}`);

  console.error(
    '\nSob o role restrito (`RUNTIME_DATABASE_URL`) a politica devolve ZERO LINHAS\n' +
      'nestes pontos, sem erro e sem log -- e a escrita falha com `42501`.\n' +
      '\n' +
      'Troque por `this.db.comTenant((tx) => tx.<modelo>.<op>(...))`, que EXIGE o\n' +
      'contexto em vez de devolver vazio. Fora de requisicao HTTP (worker, seed,\n' +
      'script), abra o escopo antes com `comContexto({ kind: ... }, ...)`.\n' +
      '\n' +
      'Ver ADR-054 SS3 e as issues #302 e #306.\n',
  );

  process.exit(1);
}

main();
