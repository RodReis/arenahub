#!/usr/bin/env node
/**
 * Guarda da REGRA 1 DO DS (§11) na camada que o ESLint nao alcanca: o CSS.
 *
 *   node scripts/check-css-tokens.mjs
 *
 * POR QUE ELA EXISTE
 * ------------------
 * `packages/config/eslint/design-system.js` implementa as seis regras do
 * contrato com seletores de AST -- `Literal`, `TemplateElement`. Isso e
 * JavaScript: nenhum deles enxerga um `.css`. A regra 1 diz "hex literal fora
 * de packages/ui/tokens e erro", e ate hoje ela so valia para hex escrito
 * dentro de TSX.
 *
 * Nao e hipotese: 32 valores `oklch()` do `shadcn add` moraram em
 * `apps/admin-web/app/globals.css` com lint verde o tempo todo, num arquivo
 * cujo proprio comentario mandava nao reintroduzir valor literal. Regra que
 * so existe em documento nao vale -- e a mesma tese do `eslint/base.js`.
 *
 * O QUE ELA PEGA
 * --------------
 * Cor literal em `.css`: hex (`#RGB`..`#RRGGBBAA`), `rgb()`/`rgba()`,
 * `hsl()`/`hsla()` e `oklch()`/`oklab()`/`lab()`/`lch()` com valor cru.
 *
 * O QUE ELA NAO PEGA, DE PROPOSITO
 * --------------------------------
 * - `packages/ui/tokens/**` e `dist-tokens/**`: a fonte legitima de hex, que
 *   e justamente o que a regra 1 protege.
 * - `color-mix(... var(--ah-*) ...)`: composicao sobre token continua sendo
 *   token; o repositorio ja usa isso em varios lugares.
 * - `#` seguido de digito em COMENTARIO: `#118`, `#229` sao numeros de issue,
 *   e a prosa deste repositorio cita cor medida (`#A6AEB9`) para explicar a
 *   decisao. Comentario e documentacao, nao declaracao.
 * - Excecao NOMEADA por arquivo+motivo na lista abaixo. Nominal e curta de
 *   proposito: um glob generoso reabriria o buraco que a guarda fecha.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = process.cwd();

/** Arvores onde hex e a fonte da verdade, nao um vazamento. */
const IGNORADOS = [
  'node_modules',
  '.next',
  'dist',
  'dist-tokens',
  join('packages', 'ui', 'tokens'),
  'coverage',
  '.turbo',
  '.git',
];

/**
 * Excecao nominal: arquivo, o trecho exato e o PORQUE.
 *
 * Toda entrada aqui e uma decisao registrada, nao um "por enquanto". Se o
 * motivo nao couber numa linha, provavelmente nao e excecao -- e token
 * faltando.
 */
const EXCECOES = [
  {
    arquivo: join('apps', 'kiosk', 'app', 'globals.css'),
    trecho: '#fff',
    motivo:
      'QR SEMPRE sobre branco -- DS-TOTEM.md §5.6. Sobre o carbono do totem a ' +
      'maioria dos leitores de celular nao encontra o padrao.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '#ffffff',
    motivo:
      'QR do segundo fator SEMPRE sobre branco, mesmo motivo do totem: fundo que ' +
      'seguisse o tema escuro inverteria o contraste dos modulos e o leitor falha.',
  },
  {
    arquivo: join('apps', 'kiosk', 'app', 'globals.css'),
    trecho: 'linear-gradient(145deg, #d8dee5, #8d97a3 45%, #e9edf1)',
    motivo:
      'Gradiente metalico da moldura de pre-visualizacao -- DS-TOTEM.md §3.1 o ' +
      'especifica em hex. E cromo de moldura, nao cor de marca nem de conteudo.',
  },
  /*
   * As cinco entradas abaixo sao a MESMA decisao: o hero de login sem tenant
   * (F71) nao tem accent resolvido por tenant -- nao ha tenant nesta coluna --
   * e o gradiente do icone/badge usa o azul de MARCA do ArenaHub, identico ao
   * que `packages/ui/tokens/app.json` ja declara para o mobile
   * (brand.markFrom/markMid/markTo/frame, accent.text). So a DECLARACAO das
   * cinco variaveis locais precisa do literal; todo uso delas no resto do
   * arquivo segue por `color-mix()`, ja isento pela funcao acima.
   */
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--hero-mark-from: #7DA2FF',
    motivo: 'brand.markFrom do app.json -- inicio do gradiente do icone da marca.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--hero-mark-mid: #2E4FD0',
    motivo: 'brand.markMid do app.json -- meio do gradiente do icone da marca.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--hero-mark-to: #9DB8FF',
    motivo: 'brand.markTo do app.json -- fim do gradiente do icone da marca.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--hero-mark-frame: #0D1226',
    motivo: 'brand.frame do app.json -- miolo escuro atras do icone da marca.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--hero-kicker: #8FB0FF',
    motivo: 'accent.text (tema escuro) do app.json -- overline e texto de apoio sobre a foto.',
  },
  /*
   * Bloco do TEMA claro/escuro do lado do formulario, so no login sem tenant
   * (F71) -- DS-PAINEL.md §2.1/§2.2. Escopo FECHADO nesta tela: portar tema
   * para o resto do painel exige extender packages/ui/tokens (fatia propria).
   * O claro reaproveita --ah-* ja gerados sem hex novo; so o bloco ESCURO e o
   * gradiente do botao fixo precisam de literal, porque nenhum dos dois
   * existe ainda no pipeline de tokens.
   */
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-action-gradient: linear-gradient(100deg, #5B86FF, #3E63E8)',
    motivo: 'accent.gradientFrom/To do app.json -- botao primario do login sem tenant.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-action-gradient-hover: linear-gradient(100deg, #6B92FF, #4A6FF0)',
    motivo: 'accent.gradientHoverFrom/To do app.json -- hover do botao primario.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-action-text: #3E63E8',
    motivo: 'DS-PAINEL.md §2.2 -- --pa-acc claro, fixo no login sem tenant.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-focus-ring: #3E63E8',
    motivo: 'DS-PAINEL.md §2.2 -- --pa-acc claro, anel de foco do botao fixo.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-surface-canvas: #0A0B0D',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-bg escuro, fundo do lado do formulario.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-surface-raised: #121417',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-card escuro, fundo de campo.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-border-subtle: #1A2032',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-line2 escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-border-default: #232A3D',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-line escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-text-placeholder: #8D97A3',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-ink4 escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-text-secondary: #A6AEB9',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-ink3 escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-text-label: #C3CAD4',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-ink2 escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-text-default: #E5E9EE',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-ink1 escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-text-strong: #F5F7F9',
    motivo: 'DS-PAINEL.md §2.1 -- --pa-ink escuro.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-action-text: #8FB0FF',
    motivo: 'DS-PAINEL.md §2.2 -- --pa-acc escuro, fixo no login sem tenant.',
  },
  {
    arquivo: join('apps', 'admin-web', 'app', '(auth)', 'login', 'login.module.css'),
    trecho: '--ah-focus-ring: #8FB0FF',
    motivo: 'DS-PAINEL.md §2.2 -- --pa-acc escuro, anel de foco do botao fixo.',
  },
];

const COR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/g;

function arquivosCss(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const rel = relative(RAIZ, caminho);
    if (IGNORADOS.some((i) => rel === i || rel.startsWith(i + sep) || nome === i)) continue;
    const info = statSync(caminho);
    if (info.isDirectory()) arquivosCss(caminho, achados);
    else if (nome.endsWith('.css')) achados.push(caminho);
  }
  return achados;
}

/**
 * Remove comentario `/* *\/` antes de procurar cor.
 *
 * Sem isto a guarda reprova a propria documentacao: este repositorio explica
 * decisao de contraste citando o hex medido, e um `#229` de issue vira erro.
 * Substitui por espaco para nao colar as linhas e estragar a contagem.
 */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '));
}

/** `color-mix(in srgb, var(--ah-x) 40%, transparent)` e token, nao literal. */
function semColorMix(fonte) {
  return fonte.replace(/color-mix\s*\([^)]*\)/g, (bloco) => bloco.replace(/[^\n]/g, ' '));
}

const violacoes = [];

for (const caminho of arquivosCss(RAIZ)) {
  const rel = relative(RAIZ, caminho);
  const bruto = readFileSync(caminho, 'utf8');
  const limpo = semColorMix(semComentarios(bruto));
  const linhas = limpo.split('\n');
  const linhasBrutas = bruto.split('\n');

  linhas.forEach((linha, i) => {
    for (const achado of linha.match(COR_LITERAL) ?? []) {
      const textoDaLinha = linhasBrutas[i] ?? '';
      const isento = EXCECOES.some(
        (e) => e.arquivo === rel && textoDaLinha.includes(e.trecho),
      );
      if (isento) continue;
      violacoes.push({ arquivo: rel, linha: i + 1, trecho: textoDaLinha.trim() });
    }
  });
}

if (violacoes.length > 0) {
  console.error(
    `\nRegra 1 do DS (§11): cor literal em CSS -- ${String(violacoes.length)} ocorrencia(s).\n`,
  );
  for (const v of violacoes) {
    console.error(`  ${v.arquivo}:${String(v.linha)}`);
    console.error(`    ${v.trecho}`);
  }
  console.error(
    '\nUse a variavel semantica (var(--ah-text-secondary), var(--ah-totem-brand-500)).',
  );
  console.error(
    'Cor que nao vem do token nao acompanha o tema nem o accent do tenant.',
  );
  console.error(
    'Precisa mesmo do literal? Declare a excecao NOMEADA, com motivo, em',
  );
  console.error('scripts/check-css-tokens.mjs.\n');
  process.exit(1);
}

console.log('ok  regra 1 do DS em CSS: nenhuma cor literal fora de tokens/');
