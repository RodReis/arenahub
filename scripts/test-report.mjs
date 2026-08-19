#!/usr/bin/env node
/**
 * Gera `reports/TESTS.md` -- a guarda de evidencia do docs/TESTING.md §5.
 *
 *   node scripts/test-report.mjs           gera o arquivo
 *   node scripts/test-report.mjs --check    falha se o commitado divergir
 *
 * O principio do TESTING.md e um so: "evidencia e saida de maquina, nunca
 * prosa". Este gerador conta ARQUIVO DE TESTE QUE EXISTE NO DISCO. Ele nao
 * inventa linha, nao estima e nao herda numero de execucao anterior.
 *
 * Hoje o repositorio nao tem nenhum teste de dominio, e o relatorio diz
 * exatamente isso. Relatorio que afirma cobertura sem teste e a forma mais
 * elegante de mentir com numero -- e e justamente o que esta guarda existe
 * para impedir.
 *
 * A classificacao e por SUFIXO de arquivo, nao por pasta nem por intencao
 * (TESTING.md §2).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'reports', 'TESTS.md');

/**
 * Niveis do TESTING.md §2, na ordem em que aparecem la.
 *
 * CADA NIVEL TEM LISTA DE SUFIXOS, nao um so: teste de componente React
 * termina em `.spec.tsx`, e `"Button.spec.tsx".endsWith(".spec.ts")` e
 * `false` -- termina em `x`. Com um sufixo unico os 17 testes de componente
 * do design system nao entravam em nivel nenhum, e a guarda de evidencia
 * afirmava 79 arquivos onde havia 96 (issue #111).
 *
 * A precedencia entre niveis continua vindo do PONTO LITERAL no sufixo, nao
 * da ordem deste array: `.int-spec.ts` nao casa `.spec.ts` porque o caractere
 * antes de `spec` e `-`. Afrouxar para `-spec.ts` faria integracao vazar para
 * unitario -- o self-check cobre exatamente esse caso.
 */
const NIVEIS = [
  { nome: 'unitário', sufixos: ['.spec.ts', '.spec.tsx'] },
  { nome: 'contrato', sufixos: ['.contract-spec.ts', '.contract-spec.tsx'] },
  { nome: 'integração', sufixos: ['.int-spec.ts', '.int-spec.tsx'] },
  { nome: 'e2e', sufixos: ['.e2e-spec.ts', '.e2e-spec.tsx'] },
  { nome: 'hardware', sufixos: ['.hw-spec.ts', '.hw-spec.tsx'] },
];

/**
 * Lista arquivos rastreados pelo Git. Usar o Git, e nao varrer o disco,
 * garante que node_modules e artefato de build ficam de fora sem precisar
 * manter uma lista de exclusao que envelhece.
 */
function arquivosRastreados() {
  const r = spawnSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('git ls-files falhou -- este script precisa rodar dentro do repositorio.');
  }
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

/**
 * O SHA da execucao NAO entra no arquivo, de proposito.
 *
 * Colocar `git rev-parse HEAD` no conteudo torna a guarda impossivel de
 * satisfazer: gerar o relatorio muda o arquivo, o que exige commit, o que
 * muda o SHA, o que desatualiza o relatorio. Ciclo infinito -- e foi o
 * terceiro defeito que o CI pegou.
 *
 * O TESTING.md §5 pede "data e SHA da execucao" e diz que vem do CI. Vem
 * mesmo: sao o timestamp e o SHA do proprio job, que ja ficam no log e na
 * pagina da execucao. O arquivo commitado carrega o que e reproduzivel a
 * partir do codigo -- nada que mude a cada commit.
 */

function gerar() {
  const arquivos = arquivosRastreados();

  const porNivel = NIVEIS.map((nivel) => ({
    ...nivel,
    arquivos: arquivos.filter((a) => nivel.sufixos.some((s) => a.endsWith(s))),
  }));

  const total = porNivel.reduce((soma, n) => soma + n.arquivos.length, 0);

  const linhas = [
    '# TESTS.md — relatório de evidência',
    '',
    '> **Gerado por `pnpm test:report`. Não edite à mão.**',
    '>',
    '> O CI roda `pnpm test:report --check` e falha se este arquivo divergir do que a execução',
    '> produz. É a guarda de evidência do `docs/TESTING.md` §5.',
    '>',
    '> **Data e SHA da execução ficam no log do CI, não aqui.** Gravá-los no arquivo tornaria a',
    '> guarda impossível de satisfazer: gerar mudaria o conteúdo, exigindo commit, que mudaria o',
    '> SHA, que desatualizaria o relatório. Este arquivo só carrega o que é reproduzível a partir',
    '> do código.',
    '',
    '## Arquivos de teste por nível',
    '',
    'Classificação por **sufixo de arquivo**, não por pasta (`docs/TESTING.md` §2).',
    '',
    '| nível | sufixo | arquivos |',
    '|---|---|---|',
    ...porNivel.map(
      (n) => `| ${n.nome} | ${n.sufixos.map((s) => `\`${s}\``).join(', ')} | ${n.arquivos.length} |`,
    ),
    `| **total** | | **${total}** |`,
    '',
  ];

  if (total === 0) {
    linhas.push(
      '## Nenhum teste de domínio existe ainda',
      '',
      'Isto não é falha do relatório — é o estado real do repositório. O bootstrap `[INFRA]`',
      'monta o encanamento; teste de domínio nasce com a primeira fatia que tiver regra a provar.',
      '',
      '**Enquanto esta linha existir, nenhum documento deste repositório pode afirmar que há',
      'cobertura.** Cobertura de regra de domínio: **n/a** — não há regra de domínio.',
      '',
      'O que já é verificado por máquina, e vale registrar para não parecer que nada roda:',
      '',
      '- `pnpm lint` e `pnpm typecheck` sobre `packages/config` e `packages/database`;',
      '- `pnpm test:guardas` — 6 casos sobre os guardas de `scripts/`;',
      '- `pnpm test:report:selfcheck` — o self-check deste gerador.',
      '',
      'Nenhum deles é teste de regra de negócio, e por isso nenhum entra na tabela acima.',
      '',
    );
  } else {
    linhas.push(
      '## Por SPEC / fatia',
      '',
      '> A ligação SPEC ↔ teste vem da tag no teste ou do caminho do módulo',
      '> (`docs/TESTING.md` §5). Preenchida quando houver teste com tag.',
      '',
    );
  }

  return linhas.join('\n');
}

function main() {
  const conteudo = gerar();
  const verificar = process.argv.includes('--check');

  if (!verificar) {
    mkdirSync(dirname(DESTINO), { recursive: true });
    writeFileSync(DESTINO, conteudo, 'utf8');
    console.info(`[test:report] ${DESTINO} atualizado.`);
    return 0;
  }

  if (!existsSync(DESTINO)) {
    console.error(
      [
        '',
        'ERRO: reports/TESTS.md nao existe.',
        '',
        'A guarda de evidencia (docs/TESTING.md §5) exige o relatorio commitado no PR.',
        'Rode `pnpm test:report` e commite o resultado.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  // Normaliza fim de linha: o repositorio roda em Windows e Linux, e CRLF vs
  // LF nao e divergencia de conteudo.
  const commitado = readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n');

  if (commitado.trim() !== conteudo.trim()) {
    console.error(
      [
        '',
        'ERRO: reports/TESTS.md divergiu do que a execucao produz.',
        '',
        'O relatorio commitado nao corresponde ao estado real do repositorio.',
        'Isso e exatamente o que a guarda de evidencia existe para pegar:',
        'numero em documento tem de vir de execucao, nunca de prosa.',
        '',
        'Rode `pnpm test:report` e commite o resultado.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  console.info('[test:report] relatorio confere com a execucao.');
  return 0;
}

process.exit(main());
