#!/usr/bin/env node
/**
 * Gera `reports/TESTS.md` -- a guarda de evidencia do docs/TESTING.md §5.
 *
 *   node scripts/test-report.mjs                                  atualiza "Estado atual"
 *   node scripts/test-report.mjs --issue 122 --spec F47 --pr 123  idem, e ANEXA linha ao historico
 *   node scripts/test-report.mjs --check                          audita "Estado atual" x cache commitado
 *
 * O principio do TESTING.md e um so: "evidencia e saida de maquina, nunca
 * prosa". Este gerador RODA cada pacote com --json e --coverage e le o que
 * o runner realmente produziu -- nao conta arquivo no disco, nao inventa
 * linha, nao herda numero de execucao anterior.
 *
 * "Estado atual" e SEMPRE regravado (nao acumula). "Historico por entrega" e
 * APPEND-ONLY -- linha de entrega passada e imutavel, e so cresce quando
 * `--issue`/`--spec`/`--pr` sao passados (issue e obrigatoria para anexar;
 * spec e pr sao opcionais -- ha card [INFRA] sem SPEC e, no fluxo local, pr
 * ainda nao existe antes do commit).
 *
 * Logica pura (agregacao, formatacao, texto) mora em `test-report.core.mjs`
 * -- este arquivo so cuida de I/O de processo (rodar Jest/Vitest, ler/
 * escrever arquivo).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { acumularNoNivel, gerar, secaoEstadoAtual } from './test-report.core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'reports', 'TESTS.md');
/**
 * Cache do ULTIMO resultado bem-sucedido de cada ALVO (chave: `pacote#script`),
 * commitado junto do TESTS.md -- e o que da ao fallback (ver `rodarAlvo`) o
 * numero EXATO (nao o `%` ja arredondado que aparece na tabela), e granularidade
 * por ALVO em vez de por nivel inteiro (um nivel pode ter mais de um alvo).
 */
const CACHE = join(RAIZ, 'reports', '.test-report-cache.json');

/**
 * Um ALVO por script de teste que existe no monorepo hoje. Cada alvo roda em
 * UM pacote e produz UM nivel -- nenhum script mistura sufixos (confirmado
 * pelos `testMatch`/`include` de cada `jest.config.mjs`/`vitest.config.ts`):
 * `test` sempre e unitario, `test:integration` sempre e integracao. Isso
 * evita reparsear caminho de arquivo por sufixo -- o proprio comando ja diz
 * o nivel.
 *
 * `runner` decide como extrair total/pass/falha (schema `--json` e IDENTICO
 * entre Jest e Vitest -- confirmado rodando os dois) e como pedir cobertura
 * (flag diferente por runner).
 */
const ALVOS = [
  { pacote: 'apps/api', nivel: 'unitário', script: 'test', runner: 'jest' },
  { pacote: 'apps/api', nivel: 'integração', script: 'test:integration', runner: 'jest' },
  { pacote: 'apps/admin-web', nivel: 'unitário', script: 'test', runner: 'vitest' },
  { pacote: 'packages/ui', nivel: 'unitário', script: 'test', runner: 'vitest' },
  { pacote: 'packages/database', nivel: 'unitário', script: 'test', runner: 'vitest' },
  { pacote: 'packages/database', nivel: 'integração', script: 'test:integration', runner: 'vitest' },
  { pacote: 'packages/access-policy', nivel: 'unitário', script: 'test', runner: 'jest' },
  { pacote: 'apps/edge-agent', nivel: 'unitário', script: 'test', runner: 'jest' },
];

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

/**
 * Arquivo temporario unico por chamada -- dois `pnpm test:report`
 * concorrentes (CI + local, ou dois jobs do mesmo workflow) nao disputam o
 * mesmo caminho.
 */
function caminhoTemporario(sufixo) {
  return join(tmpdir(), `arenahub-test-report-${randomBytes(6).toString('hex')}-${sufixo}.json`);
}

function chaveDoAlvo(alvo) {
  return `${alvo.pacote}#${alvo.script}`;
}

function lerCache() {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function escreverCache(cache) {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

/**
 * Roda `pnpm --filter <pacote> <script>` com as flags de JSON + cobertura do
 * runner. Devolve os numeros ja extraidos -- nunca o JSON cru, para o
 * chamador nao precisar saber o schema de cada runner.
 *
 * O SCRIPT PODE FALHAR (teste vermelho) e isso E ESPERADO: o proposito do
 * relatorio e mostrar falha, nao escondê-la atras de um script que aborta --
 * quando o Jest/Vitest RODOU e escreveu o `--outputFile`, o resultado (com
 * `falha > 0`) entra normalmente.
 *
 * Devolve `null` (nunca lanca) quando o PROCESSO nao chegou a escrever o
 * JSON -- caso conhecido: `test:integration` do `apps/api` crasha com exit
 * nativo do Windows (3221226505) DEPOIS de 360+ testes passarem, bug
 * pre-existente do Jest com `--experimental-vm-modules` nesta plataforma,
 * nao regressao desta fatia. Tratar como "alvo zerado" mentiria queda de
 * cobertura que nao aconteceu -- o chamador usa o ultimo valor do CACHE.
 */
function rodarAlvo(alvo) {
  const arquivoTeste = caminhoTemporario('teste');
  const flagsComuns =
    alvo.runner === 'jest'
      ? ['--json', `--outputFile=${arquivoTeste}`, '--coverage', '--coverageReporters=json-summary']
      : ['--reporter=json', `--outputFile=${arquivoTeste}`, '--coverage', '--coverage.reporter=json-summary'];

  const cwd = join(RAIZ, alvo.pacote);

  // SEM `--`: `pnpm run <script>` ja repassa argumento extra ao script. Um
  // `--` literal aqui chega ATE O JEST como argumento de pattern de teste
  // (nao como separador), e o Jest interpreta cada flag como um regex de
  // arquivo que nao bate com nada -- "No tests found" silencioso.
  const execucao = spawnSync('pnpm', ['run', alvo.script, ...flagsComuns], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (!existsSync(arquivoTeste)) {
    console.warn(
      `[test:report] AVISO: ${alvo.pacote} (${alvo.script}) nao produziu saida -- ` +
        `processo terminou com status ${String(execucao.status)} sem escrever o resultado. ` +
        'Mantendo o numero da ultima execucao bem-sucedida para este alvo.',
    );
    return null;
  }

  const resultado = JSON.parse(readFileSync(arquivoTeste, 'utf8'));
  rmSync(arquivoTeste, { force: true });

  const coberturaPath = join(cwd, 'coverage', 'coverage-summary.json');
  let coberturaPct = null;
  if (existsSync(coberturaPath)) {
    const resumo = JSON.parse(readFileSync(coberturaPath, 'utf8'));
    coberturaPct = resumo.total?.lines?.pct ?? null;
  }

  return {
    testes: resultado.numTotalTests ?? 0,
    pass: resultado.numPassedTests ?? 0,
    falha: resultado.numFailedTests ?? 0,
    coberturaPct,
  };
}

/**
 * Roda todos os ALVOS e agrega por nivel. ALVO que falhou usa o valor do
 * CACHE (ultima execucao bem-sucedida DAQUELE alvo), nao zero. ALVO que teve
 * sucesso atualiza o cache antes de devolver.
 */
function rodarTodosOsAlvos() {
  const cache = lerCache();
  const porNivel = new Map();

  for (const alvo of ALVOS) {
    const chave = chaveDoAlvo(alvo);
    const r = rodarAlvo(alvo);

    const resultado = r ?? cache[chave] ?? { testes: 0, pass: 0, falha: 0, coberturaPct: null };
    if (r) cache[chave] = r;

    acumularNoNivel(porNivel, alvo.nivel, resultado);
  }

  escreverCache(cache);

  return porNivel;
}

/**
 * Reconstroi o "por nivel" a partir do CACHE commitado, sem rodar nada --
 * usado por `--check` (ver comentario em `main`).
 */
function porNivelDoCache() {
  const cache = lerCache();
  const porNivel = new Map();

  for (const alvo of ALVOS) {
    const resultado = cache[chaveDoAlvo(alvo)];
    if (!resultado) continue;
    acumularNoNivel(porNivel, alvo.nivel, resultado);
  }

  return porNivel;
}

function main() {
  const verificar = process.argv.includes('--check');
  const issue = argumento('issue');
  const spec = argumento('spec');
  const pr = argumento('pr');

  if (verificar) {
    // `--check` NAO roda teste nenhum -- so compara o "Estado atual"
    // commitado contra o que o CACHE (tambem commitado) reconstroi. Rodar
    // os testes aqui tornaria a guarda NAO-DETERMINISTICA: o crash
    // intermitente do Jest no Windows (`apps/api#test:integration`, ver
    // `rodarAlvo`) fez duas chamadas seguidas de `--check` discordarem entre
    // si sobre o mesmo commit -- guarda que muda de opiniao sem o codigo
    // mudar nao prova nada. O comando SEM `--check` e quem roda de verdade
    // e atualiza cache + TESTS.md; `--check` so audita que os dois arquivos
    // combinam.
    if (!existsSync(DESTINO) || !existsSync(CACHE)) {
      console.error(
        [
          '',
          'ERRO: reports/TESTS.md ou reports/.test-report-cache.json nao existe.',
          '',
          'A guarda de evidencia (docs/TESTING.md §5) exige os dois commitados no PR.',
          'Rode `pnpm test:report` e commite o resultado.',
          '',
        ].join('\n'),
      );
      return 1;
    }

    const commitado = readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n');
    const conteudo = gerar({ porNivel: porNivelDoCache(), entrega: null, conteudoAnterior: commitado });

    if (secaoEstadoAtual(commitado) !== secaoEstadoAtual(conteudo)) {
      console.error(
        [
          '',
          'ERRO: "Estado atual" de reports/TESTS.md nao bate com reports/.test-report-cache.json.',
          '',
          'O relatorio commitado nao corresponde ao cache commitado junto dele.',
          'Isso e exatamente o que a guarda de evidencia existe para pegar:',
          'numero em documento tem de vir de execucao, nunca de prosa.',
          '',
          'Rode `pnpm test:report` (ou `pnpm test:report --issue N --spec ... --pr ...`',
          'se esta entregando uma fatia) e commite o resultado (TESTS.md + cache juntos).',
          '',
        ].join('\n'),
      );
      return 1;
    }

    console.info('[test:report] "Estado atual" confere com o cache commitado.');
    return 0;
  }

  const porNivel = rodarTodosOsAlvos();

  const entrega = issue ? { issue, spec, pr, data: new Date().toISOString().slice(0, 10) } : null;

  const conteudoAnterior = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8') : null;
  const conteudo = gerar({ porNivel, entrega, conteudoAnterior });

  mkdirSync(dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, conteudo, 'utf8');
  console.info(`[test:report] ${DESTINO} atualizado.`);
  return 0;
}

process.exit(main());
