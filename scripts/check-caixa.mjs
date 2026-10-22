#!/usr/bin/env node
/**
 * Guarda da CAIXA DO TEXTO DA INTERFACE: sentence case, sempre (decisao do PI,
 * 22/10/2026, issue #664).
 *
 *   node scripts/check-caixa.mjs
 *
 * POR QUE ELA EXISTE
 * ------------------
 * A interface misturava CAIXA ALTA (rotulo, cabecalho de tabela, overline),
 * Title Case e sentence case. Caixa alta por CSS e a forma mais barata de
 * voltar: uma linha `text-transform: uppercase` num modulo novo e o texto
 * "grita" de novo, com lint, typecheck e testes verdes. Regra que so existe em
 * documento nao vale (mesma tese do `check-css-tokens`).
 *
 * O QUE ELA PEGA (admin-web, kiosk, mobile e packages/ui, fora de teste)
 * ----------------------------------------------------------------------
 * 1. CSS: `text-transform: uppercase|capitalize`.
 * 2. TSX: `textTransform: 'uppercase'`, classe `uppercase`/`capitalize` do
 *    Tailwind e `.toUpperCase()`/`.toLocaleUpperCase()`.
 * 3. Literal de tela em caixa alta com mais de uma palavra
 *    (`'PLANO ATUAL'`, `AGOSTO · TREINOS`). Sigla e palavra solta (CPF, PIX,
 *    enum) nao entram.
 *
 * O QUE ELA NAO PEGA, DE PROPOSITO
 * --------------------------------
 * - Comentario: documentacao pode citar o texto antigo.
 * - Teste/spec/e2e: o teste asserta o que a tela mostra, nao define a regra.
 * - Excecao NOMEADA por arquivo+trecho+motivo abaixo. Nominal e curta de
 *   proposito: `toUpperCase` para chave de lookup ou inicial de avatar nao e
 *   texto gritado, mas so a excecao nomeada diz isso.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = process.cwd();

const VARRIDOS = [
  join('apps', 'admin-web'),
  join('apps', 'kiosk'),
  join('apps', 'mobile'),
  join('packages', 'ui', 'src'),
];

const IGNORADOS = ['node_modules', '.next', 'dist', 'dist-tokens', 'coverage', '.turbo', '.git', 'tests', 'e2e', '.expo'];

const EH_TESTE = /\.(?:test|spec|e2e-spec)\.[jt]sx?$/;

/** Arquivo+trecho exato+PORQUE. Se o motivo nao couber numa linha, nao e excecao. */
const EXCECOES = [
  {
    arquivo: join('apps', 'admin-web', 'app', '(protected)', 'usuario.tsx'),
    trecho: '.toUpperCase()',
    motivo: 'Iniciais do avatar: duas letras, nao texto de leitura.',
  },
  {
    arquivo: join('apps', 'mobile', 'src', 'ui', 'Marca.tsx'),
    trecho: '.toUpperCase()',
    motivo: 'Iniciais do avatar: duas letras, nao texto de leitura.',
  },
  {
    arquivo: join('packages', 'ui', 'src', 'components', 'Identidade.tsx'),
    trecho: '.toUpperCase()',
    motivo: 'Iniciais do avatar: duas letras, nao texto de leitura.',
  },
  {
    arquivo: join('packages', 'ui', 'src', 'accent.ts'),
    trecho: '.toUpperCase()',
    motivo: 'Normaliza hex de cor (#A6AEB9); nao e texto de tela.',
  },
  {
    arquivo: join('apps', 'kiosk', 'components', 'preferencias.tsx'),
    trecho: "textTransform: 'uppercase'",
    motivo: 'Teclas do teclado virtual de letras: tecla maiuscula e o padrao de qualquer teclado.',
  },
  {
    arquivo: join('apps', 'mobile', 'src', 'ui', 'nome.ts'),
    trecho: ".toLocaleUpperCase('pt-BR')",
    motivo: 'Capitaliza a inicial do nome: e o proprio sentence case.',
  },
  {
    arquivo: join('apps', 'mobile', 'src', 'features', 'eventos', 'eventos.tsx'),
    trecho: '.toUpperCase())',
    motivo: 'Capitaliza a inicial do mes no comeco da frase.',
  },
  {
    arquivo: join('apps', 'mobile', 'src', 'features', 'avaliacoes', 'avaliacoes.tsx'),
    trecho: 'unidade.toUpperCase()',
    motivo: 'Chave de lookup do simbolo da unidade; nao vai para a tela.',
  },
  {
    arquivo: join('apps', 'mobile', 'src', 'features', 'avaliacoes', 'avaliacoes.tsx'),
    trecho: 'unidade?.toUpperCase()',
    motivo: 'Comparacao com o enum PERCENT; nao vai para a tela.',
  },
  {
    arquivo: join('apps', 'kiosk', 'lib', 'saude.ts'),
    trecho: 'unidade.toUpperCase()',
    motivo: 'Chave de lookup do simbolo da unidade; nao vai para a tela.',
  },
  {
    arquivo: join('apps', 'admin-web', 'src', 'health', 'formatar.ts'),
    trecho: 'unidade.toUpperCase()',
    motivo: 'Chave de lookup do simbolo da unidade; nao vai para a tela.',
  },
];

const PADROES = [
  { nome: 'text-transform em CSS', regex: /text-transform\s*:\s*(?:uppercase|capitalize)/, so: 'css' },
  { nome: 'textTransform em estilo', regex: /textTransform\s*:\s*['"](?:uppercase|capitalize)['"]/, so: 'ts' },
  { nome: 'classe uppercase/capitalize do Tailwind', regex: /(?<=["'`\s])(?:uppercase|capitalize)(?=["'`\s])/, so: 'ts' },
  { nome: 'toUpperCase em texto', regex: /\.to(?:Locale)?UpperCase\s*\(/, so: 'ts' },
  {
    nome: 'literal de tela em CAIXA ALTA',
    // Duas ou mais palavras em caixa alta entre aspas/crase/JSX; `·` separa.
    regex: /(?<=["'`>]\s*)[A-ZÀ-ÖØ-Ý]{3,}(?:\s+(?:·\s+)?[A-ZÀ-ÖØ-Ý]{2,})+(?=\s*(?:["'`<]|\$\{))/,
    so: 'ts',
  },
];

function arquivos(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (IGNORADOS.includes(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.(?:css|tsx?)$/.test(nome) && !EH_TESTE.test(nome) && !nome.endsWith('.d.ts')) achados.push(caminho);
  }
  return achados;
}

/** Troca comentario por espaco, preservando as quebras de linha (numero de linha estavel). */
function semComentarios(fonte, css) {
  const branco = (bloco) => bloco.replace(/[^\n]/g, ' ');
  const semBloco = fonte.replace(/\/\*[\s\S]*?\*\//g, branco);
  return css ? semBloco : semBloco.replace(/(^|\s)\/\/[^\n]*/g, (m, ini) => ini + branco(m.slice(ini.length)));
}

const violacoes = [];

for (const base of VARRIDOS) {
  const dir = join(RAIZ, base);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const caminho of arquivos(dir)) {
    const rel = relative(RAIZ, caminho);
    const css = caminho.endsWith('.css');
    const bruto = readFileSync(caminho, 'utf8').split('\n');
    const limpo = semComentarios(readFileSync(caminho, 'utf8'), css).split('\n');

    limpo.forEach((linha, i) => {
      for (const p of PADROES) {
        if ((p.so === 'css') !== css) continue;
        if (!p.regex.test(linha)) continue;
        const textoDaLinha = bruto[i] ?? '';
        if (EXCECOES.some((e) => e.arquivo === rel && textoDaLinha.includes(e.trecho))) continue;
        violacoes.push({ arquivo: rel, linha: i + 1, nome: p.nome, trecho: textoDaLinha.trim() });
      }
    });
  }
}

if (violacoes.length > 0) {
  console.error(`\nCaixa do texto: ${String(violacoes.length)} ocorrencia(s) fora de sentence case.\n`);
  for (const v of violacoes) {
    console.error(`  ${v.arquivo}:${String(v.linha)}  [${v.nome}]`);
    console.error(`    ${v.trecho}`);
  }
  console.error('\nEscreva o texto em sentence case ("Plano atual") e tire a transformacao do CSS.');
  console.error('Precisa mesmo (iniciais, chave de lookup)? Declare a excecao NOMEADA, com motivo, em');
  console.error('scripts/check-caixa.mjs.\n');
  process.exit(1);
}

console.log('ok  caixa do texto: sentence case em toda a interface');
