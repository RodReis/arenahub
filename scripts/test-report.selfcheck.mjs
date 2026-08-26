#!/usr/bin/env node
/**
 * Self-check do gerador de relatorio (`docs/TESTING.md` §5).
 *
 *   node scripts/test-report.selfcheck.mjs
 *
 * "Gerador de relatorio sem teste e a forma mais elegante de mentir com
 * numero." Testa as funcoes PURAS de `test-report.core.mjs` -- agregacao por
 * nivel, formatacao, deteccao de divergencia entre "Estado atual" e
 * historico. Nao roda Jest/Vitest de verdade (isso levaria minutos e
 * herdaria o crash intermitente do `test:integration` no Windows) -- o que
 * este arquivo garante e que a LOGICA de contagem/agregacao/comparacao esta
 * certa, dado um resultado ja extraido.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALVOS, acumularNoNivel, alvosFaltando, formatarPct, gerar, historicoExistente, linhaDeNivel, NIVEIS, secaoEstadoAtual } from './test-report.core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Le os workspaces reais do disco: `apps/*` e `packages/*` com package.json. */
function workspacesDoDisco(raiz = RAIZ) {
  return ['apps', 'packages'].flatMap((grupo) => {
    const base = join(raiz, grupo);
    if (!existsSync(base)) return [];

    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(base, e.name, 'package.json')))
      .map((e) => ({
        pacote: `${grupo}/${e.name}`,
        scripts: JSON.parse(readFileSync(join(base, e.name, 'package.json'), 'utf8')).scripts ?? {},
      }));
  });
}

const casos = [];

casos.push([
  'formatarPct mostra travessao para null, uma casa decimal para numero',
  () => {
    assert.equal(formatarPct(null), '—');
    assert.equal(formatarPct(84.567), '84.6');
    assert.equal(formatarPct(100), '100.0');
  },
]);

casos.push([
  'linhaDeNivel sem dados sai zerada, nao ausente',
  () => {
    assert.equal(linhaDeNivel('unitário', undefined), '| unitário | 0 | 0 | 0 | — |');
  },
]);

casos.push([
  'linhaDeNivel calcula cobertura como media ponderada por peso, nao media simples',
  () => {
    // Dois alvos, pesos bem diferentes: media simples de 90/10 seria 50;
    // ponderada pelo peso (900 e 10) fica proxima de 90.
    const dados = { testes: 910, pass: 910, falha: 0, coberturaPtsSoma: 90 * 900 + 10 * 10, coberturaPeso: 910 };
    const linha = linhaDeNivel('unitário', dados);
    assert.match(linha, /\| 89\.\d \|$/, `esperava cobertura proxima de 90, veio: ${linha}`);
  },
]);

casos.push([
  'acumularNoNivel soma dois alvos do mesmo nivel',
  () => {
    let porNivel = new Map();
    porNivel = acumularNoNivel(porNivel, 'unitário', { testes: 10, pass: 9, falha: 1, coberturaPct: 80 });
    porNivel = acumularNoNivel(porNivel, 'unitário', { testes: 5, pass: 5, falha: 0, coberturaPct: 100 });

    const dados = porNivel.get('unitário');
    assert.equal(dados.testes, 15);
    assert.equal(dados.pass, 14);
    assert.equal(dados.falha, 1);
    // Ponderado: (80*10 + 100*5) / 15 = 86.67
    assert.equal((dados.coberturaPtsSoma / dados.coberturaPeso).toFixed(2), '86.67');
  },
]);

casos.push([
  'acumularNoNivel ignora coberturaPct null no peso (nao derruba a media)',
  () => {
    let porNivel = new Map();
    porNivel = acumularNoNivel(porNivel, 'e2e', { testes: 3, pass: 3, falha: 0, coberturaPct: null });
    const dados = porNivel.get('e2e');
    assert.equal(dados.coberturaPeso, 0, 'peso deveria ficar zero -- nenhum alvo com cobertura real');
  },
]);

casos.push([
  'gerar produz os 6 niveis do TESTING.md §1, mesmo sem ALVO para alguns',
  () => {
    const conteudo = gerar({ porNivel: new Map(), entrega: null, conteudoAnterior: null });
    for (const nivel of NIVEIS) {
      assert.match(conteudo, new RegExp(`\\| ${nivel} \\| 0 \\| 0 \\| 0 \\| — \\|`), `nivel "${nivel}" ausente ou nao-zerado`);
    }
  },
]);

casos.push([
  'gerar sem entrega nao acrescenta linha ao historico',
  () => {
    const porNivel = acumularNoNivel(new Map(), 'unitário', { testes: 10, pass: 10, falha: 0, coberturaPct: 90 });
    const conteudo = gerar({ porNivel, entrega: null, conteudoAnterior: null });
    const historico = conteudo.split('## Histórico por entrega')[1];
    assert.doesNotMatch(historico, /\| 20\d\d-/, 'linha de historico apareceu sem --issue');
  },
]);

casos.push([
  'gerar com entrega acrescenta uma linha por nivel com teste > 0',
  () => {
    let porNivel = new Map();
    porNivel = acumularNoNivel(porNivel, 'unitário', { testes: 10, pass: 10, falha: 0, coberturaPct: 90 });
    porNivel = acumularNoNivel(porNivel, 'integração', { testes: 0, pass: 0, falha: 0, coberturaPct: null });

    const conteudo = gerar({
      porNivel,
      entrega: { issue: '122', spec: 'F47', pr: '123', data: '2026-08-20' },
      conteudoAnterior: null,
    });

    assert.match(conteudo, /\| 2026-08-20 \| #122 \| F47 \| unitário \| 10 \| 10 \| 0 \| 90\.0 \| #123 \|/);
    // Nivel com testes=0 (integração) nao gera linha NO HISTORICO -- nada foi
    // executado ali, uma linha "0 testes" la seria ruido. A tabela "Estado
    // atual" continua mostrando integração zerada -- isso e' esperado.
    const historico = conteudo.split('## Histórico por entrega')[1];
    assert.doesNotMatch(historico, /integração/, 'nivel sem teste apareceu no historico');
  },
]);

casos.push([
  'gerar preserva o historico ja commitado ao anexar nova entrega (append-only)',
  () => {
    const anterior = gerar({
      porNivel: acumularNoNivel(new Map(), 'unitário', { testes: 5, pass: 5, falha: 0, coberturaPct: 80 }),
      entrega: { issue: '100', spec: null, pr: '101', data: '2026-08-01' },
      conteudoAnterior: null,
    });

    const novo = gerar({
      porNivel: acumularNoNivel(new Map(), 'unitário', { testes: 8, pass: 8, falha: 0, coberturaPct: 85 }),
      entrega: { issue: '122', spec: 'F47', pr: '123', data: '2026-08-20' },
      conteudoAnterior: anterior,
    });

    assert.match(novo, /\| 2026-08-01 \| #100 \| — \| unitário \| 5 \| 5 \| 0 \| 80\.0 \| #101 \|/, 'linha antiga sumiu -- historico nao e append-only');
    assert.match(novo, /\| 2026-08-20 \| #122 \| F47 \| unitário \| 8 \| 8 \| 0 \| 85\.0 \| #123 \|/, 'linha nova nao foi anexada');
  },
]);

casos.push([
  'historicoExistente devolve vazio quando nao ha secao de historico',
  () => {
    assert.deepEqual(historicoExistente(null), []);
    assert.deepEqual(historicoExistente('# so titulo, sem secoes'), []);
  },
]);

casos.push([
  'secaoEstadoAtual isola "Estado atual" do historico, para o --check nao reprovar por causa da propria linha que anexou',
  () => {
    const semEntrega = gerar({
      porNivel: acumularNoNivel(new Map(), 'unitário', { testes: 5, pass: 5, falha: 0, coberturaPct: 80 }),
      entrega: null,
      conteudoAnterior: null,
    });
    const comEntrega = gerar({
      porNivel: acumularNoNivel(new Map(), 'unitário', { testes: 5, pass: 5, falha: 0, coberturaPct: 80 }),
      entrega: { issue: '1', spec: null, pr: null, data: '2026-08-20' },
      conteudoAnterior: null,
    });

    assert.equal(
      secaoEstadoAtual(semEntrega),
      secaoEstadoAtual(comEntrega),
      '"Estado atual" mudou so por causa da entrega no historico -- --check reprovaria PR legitimo',
    );
  },
]);

casos.push([
  'secaoEstadoAtual detecta divergencia real (regressao: --check aceitando numero adulterado)',
  () => {
    const original = gerar({
      porNivel: acumularNoNivel(new Map(), 'unitário', { testes: 5, pass: 5, falha: 0, coberturaPct: 80 }),
      entrega: null,
      conteudoAnterior: null,
    });
    const adulterado = original.replace('| 5 | 5 | 0 |', '| 999 | 999 | 0 |');

    assert.notEqual(secaoEstadoAtual(original), secaoEstadoAtual(adulterado));
  },
]);

casos.push([
  'alvosFaltando acusa pacote com script test que nao esta em ALVOS',
  () => {
    const alvos = [{ pacote: 'apps/api', nivel: 'unitário', script: 'test', runner: 'jest' }];
    const workspaces = [
      { pacote: 'apps/api', scripts: { test: 'jest' } },
      { pacote: 'apps/kiosk', scripts: { test: 'vitest run' } },
    ];

    assert.deepEqual(alvosFaltando(workspaces, alvos), ['apps/kiosk#test']);
  },
]);

casos.push([
  'alvosFaltando acusa script:integration ausente mesmo com o unitario ja coberto',
  () => {
    // O bug real e' mais sutil que "pacote inteiro esquecido": o pacote esta
    // na lista pelo unitario e o test:integration dele nunca roda.
    const alvos = [{ pacote: 'packages/database', nivel: 'unitário', script: 'test', runner: 'vitest' }];
    const workspaces = [{ pacote: 'packages/database', scripts: { test: 'vitest', 'test:integration': 'vitest' } }];

    assert.deepEqual(alvosFaltando(workspaces, alvos), ['packages/database#test:integration']);
  },
]);

casos.push([
  'alvosFaltando ignora test:e2e -- Playwright roda fora do gerador (TESTING.md §5)',
  () => {
    const workspaces = [{ pacote: 'apps/kiosk', scripts: { test: 'vitest', 'test:e2e': 'playwright test' } }];
    const alvos = [{ pacote: 'apps/kiosk', nivel: 'unitário', script: 'test', runner: 'vitest' }];

    assert.deepEqual(alvosFaltando(workspaces, alvos), [], 'test:e2e nao deve ser cobrado');
  },
]);

casos.push([
  'alvosFaltando nao acusa pacote sem script de teste (packages/config)',
  () => {
    const workspaces = [{ pacote: 'packages/config', scripts: { lint: 'eslint .' } }];
    assert.deepEqual(alvosFaltando(workspaces, []), []);
  },
]);

casos.push([
  'ESTE REPOSITORIO: nenhum workspace com teste esta fora de ALVOS',
  () => {
    // A guarda contra subcontagem, rodando contra o disco de verdade. Pacote
    // novo com script `test` derruba este caso ate entrar em ALVOS -- que e' o
    // ponto: ausencia da lista deixa de ser indistinguivel de "nao tem teste".
    const faltando = alvosFaltando(workspacesDoDisco(), ALVOS);

    assert.deepEqual(
      faltando,
      [],
      `workspace com teste fora de ALVOS (invisivel no reports/TESTS.md): ${faltando.join(', ')}
` +
        `          Acrescente em scripts/test-report.core.mjs -> ALVOS.`,
    );
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
