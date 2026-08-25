/**
 * Pipeline de tokens: primitive/semantic/expression.json -> theme.css + tokens.ts
 *
 * ADR-025 decisao 1: mecanica de build, zero decisao de produto. As decisoes
 * moram nos JSON e em docs/design/DS-PAINEL.md.
 *
 * O build FALHA -- nao avisa -- quando:
 *   1. a camada semantica traz hex literal em vez de `ref` (segunda verdade);
 *   2. um `ref` aponta para token primitivo inexistente (typo silencioso);
 *   3. um par texto/superficie fica abaixo do alvo sem excecao NOMEADA.
 *
 * A terceira e a regra de lint 4 do DS-PAINEL.md §11. Ela existe porque
 * contraste que so vive em documento nao vale: alguem troca um tom, o
 * documento continua dizendo 6.56, e a tela reprova em silencio.
 *
 * Uso:  node scripts/build-tokens.mjs [--check]
 *       --check nao escreve; so verifica. E o que o CI roda.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const TOKENS = join(PKG, 'tokens');
const OUT_CSS = join(PKG, 'dist-tokens', 'theme.css');
const OUT_TS = join(PKG, 'src', 'tokens.generated.ts');

const CHECK_ONLY = process.argv.includes('--check');

const readJson = (name) => JSON.parse(readFileSync(join(TOKENS, name), 'utf8'));

const primitive = readJson('primitive.json');
const semantic = readJson('semantic.json');
const expression = readJson('expression.json');
const totem = readJson('totem.json');

const errors = [];

/* ---------------------------------------------------------------- contraste */

const parseHex = (hex) => {
  const c = hex.trim().replace(/^#/, '');
  const full =
    c.length === 3
      ? c
          .split('')
          .map((x) => x + x)
          .join('')
      : c;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Hex invalido: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const luminance = (hex) => {
  const ch = (raw) => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Mistura `fg` sobre `bg` na proporcao `p` -- o mesmo que `color-mix` faz em
 * runtime. Existe para o gate medir o par REAL: o badge de estado nao pinta
 * sobre branco, pinta sobre 10% de si mesmo (DS-PAINEL §2.2).
 */
const mix = (fg, bg, p) => {
  const a = parseHex(fg);
  const b = parseHex(bg);
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${a.map((v, i) => hex(v * p + b[i] * (1 - p))).join('')}`;
};

/** Fundo do badge -- DS-PAINEL §2.2: tom a 10% sobre a superficie do card. */
const TINT_DO_BADGE = 0.1;

/* -------------------------------------------------------- resolucao de `ref` */

const WHITE = '#FFFFFF';

/** `carbon.500` -> `#565E69`. `white` e literal aceito -- e superficie, nao paleta. */
function resolveRef(ref, where = '(desconhecido)') {
  // Sem `ref` nao ha o que resolver. Sem esta guarda o pipeline morria de
  // TypeError -- exit 1 por acidente, com stack de Node no lugar da mensagem
  // que diz QUAL token esta errado. Falhar certo importa tanto quanto falhar.
  if (typeof ref !== 'string' || ref.length === 0) {
    errors.push(
      `token sem "ref" em ${where}. Todo papel da camada semantica aponta ` +
        `para um primitivo por "ref" (ex.: "carbon.500").`,
    );
    return null;
  }

  if (ref === 'white') return WHITE;

  const parts = ref.split('.');
  let node = primitive;

  for (const part of parts) {
    if (node == null || typeof node !== 'object' || !(part in node)) {
      errors.push(`ref inexistente em primitive.json: "${ref}"`);
      return null;
    }
    node = node[part];
  }

  if (node && typeof node === 'object' && 'value' in node) return node.value;
  if (typeof node === 'string' || typeof node === 'number') return node;

  errors.push(`ref "${ref}" nao aponta para um valor`);
  return null;
}

/**
 * Varre a camada semantica procurando hex literal.
 *
 * Um hex aqui e uma segunda verdade: o primitivo diz uma coisa, o semantico
 * diz outra, e o proximo a mexer conserta o lado errado.
 */
function assertNoLiteralHex(node, path = 'semantic') {
  if (typeof node === 'string') {
    if (/^#[0-9a-fA-F]{3,8}$/.test(node.trim())) {
      errors.push(
        `hex literal em ${path}: "${node}". A camada semantica so aponta ` +
          `para primitivos por "ref" (regra de lint 1).`,
      );
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      // `against` aceita branco literal: e a superficie do papel, nao paleta.
      if (key === 'against' || key === '$comment' || key.startsWith('$')) continue;
      assertNoLiteralHex(child, `${path}.${key}`);
    }
  }
}

assertNoLiteralHex(semantic);

/**
 * Aborta ANTES de resolver refs.
 *
 * Um semantic.json com hex literal ja esta invalido; seguir em frente so
 * produz erros derivados que escondem a causa raiz no meio da lista.
 */
if (errors.length > 0) {
  process.stderr.write(`\n✗ pipeline de tokens reprovou (${errors.length}):\n\n`);
  for (const e of errors) process.stderr.write(`  · ${e}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

/* ------------------------------------------------ verificacao de contraste */

const surfaces = {};
for (const [name, def] of Object.entries(semantic.surface ?? {})) {
  if (name.startsWith('$')) continue;
  const hex = resolveRef(def.ref, `semantic.surface.${name}`);
  if (hex) surfaces[`surface.${name}`] = hex;
}

const contrastReport = [];

for (const [name, def] of Object.entries(semantic.text ?? {})) {
  if (name.startsWith('$')) continue;

  const fg = resolveRef(def.ref, `semantic.text.${name}`);
  const bgKey = def.on ?? 'surface.raised';
  const bg = surfaces[bgKey];

  if (!fg || !bg) continue;

  const value = round2(contrast(fg, bg));
  const exempt = def.$exempt;

  contrastReport.push({ role: `text.${name}`, fg, bg: bgKey, value, exempt: exempt ?? null });

  if (value < 4.5 && !exempt) {
    errors.push(
      `contraste reprovado: text.${name} (${fg}) sobre ${bgKey} (${bg}) = ` +
        `${value}, alvo 4.5. Use um tom mais escuro OU declare "$exempt" com ` +
        `"$why" citando a clausula WCAG que isenta (regra de lint 4).`,
    );
  }
}

// Excecao nomeada do controle desabilitado -- SPEC-042 §5 pergunta 2, opcao A.
const disabledText = semantic.control?.disabled?.text;
if (disabledText && !disabledText.$exempt) {
  errors.push(
    'control.disabled.text precisa de "$exempt" nomeada. WCAG 2.2 §1.4.3 ' +
      'isenta componente inativo -- mas a isencao tem de estar ESCRITA, ' +
      'senao a proxima pessoa "conserta" o token.',
  );
}

/**
 * Badge de estado -- o tom solido tem de passar sobre O FUNDO QUE ELE PINTA.
 *
 * Media contra BRANCO ate 18/08/2026, e o par estava errado: o badge usa
 * `color-mix(currentColor 10%, surface-raised)` como fundo (§2.2), nao branco.
 * A diferenca nao e academica -- `success` passava com 5.08 sobre branco e
 * entregava 4.44 sobre o proprio tint, reprovando o alvo de 4.5 na tela. O
 * axe pegou; o gate que existe para pegar antes, nao.
 *
 * O tint e mais claro que o solido, entao medir sobre branco e sempre
 * OTIMISTA: nenhuma cor passa aqui e falha la, e o inverso acontecia.
 */
for (const [name, def] of Object.entries(semantic.state ?? {})) {
  if (name.startsWith('$')) continue;
  const fg = resolveRef(def.ref, `semantic.state.${name}`);
  if (!fg) continue;
  const fundo = mix(fg, WHITE, TINT_DO_BADGE);
  const value = round2(contrast(fg, fundo));
  contrastReport.push({ role: `state.${name}`, fg, bg: fundo, value, exempt: null });
  if (value < 4.5) {
    errors.push(
      `contraste reprovado: state.${name} (${fg}) sobre o proprio tint de 10% (${fundo}) = ${value}, alvo 4.5.`,
    );
  }
}

/* ------------------------------------------------------------------ saida */

const cssLines = [];
const push = (line) => cssLines.push(line);

push('/* GERADO POR scripts/build-tokens.mjs -- NAO EDITE A MAO. */');
push('/* Fonte: packages/ui/tokens/*.json  ·  Contrato: docs/design/DS-PAINEL.md */');
push('');
push(':root {');

for (const [tone, def] of Object.entries(primitive.carbon)) {
  push(`  --ah-carbon-${tone}: ${def.value};`);
}
push('');
for (const [role, def] of Object.entries(primitive.semantic)) {
  if (role.startsWith('$')) continue;
  push(`  --ah-${role}: ${def.value};`);
}
push('');
for (const [tone, def] of Object.entries(primitive.accent)) {
  if (tone === 'seed' || tone.startsWith('$')) continue;
  push(`  --ah-accent-${tone}: ${def.value};`);
}
push('');
for (const [name, def] of Object.entries(primitive.type)) {
  if (name.startsWith('$')) continue;
  push(`  --ah-type-${name}-size: ${def.size}px;`);
  push(`  --ah-type-${name}-lh: ${def.lineHeight}px;`);
  push(`  --ah-type-${name}-weight: ${def.weight};`);
}
push('');
push(`  --ah-font-sans: ${primitive.font.sans};`);
push(`  --ah-font-mono: ${primitive.font.mono};`);
push('');
for (const [level, value] of Object.entries(primitive.elevation)) {
  if (level.startsWith('$')) continue;
  push(`  --ah-elev-${level}: ${value};`);
}
push('');
push(`  --ah-motion-control: ${primitive.motion.controlFeedback}ms;`);
push(`  --ah-motion-layer: ${primitive.motion.layerOpen}ms;`);
push(`  --ah-motion-easing: ${primitive.motion.easing};`);
push('}');
push('');

/**
 * `onChrome` -> `on-chrome`.
 *
 * Custom property em camelCase e legal em CSS, mas nao e o que o resto do
 * arquivo faz -- e mistura de convencao vira erro de digitacao silencioso:
 * `var(--ah-text-onchrome)` nao resolve e o navegador nao avisa.
 */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// Camada semantica -- o que os componentes leem.
push('/* Camada semantica: PAPEL. Componente le daqui, nunca do primitivo. */');
push(':root {');
for (const [group, entries] of Object.entries(semantic)) {
  if (group.startsWith('$')) continue;
  for (const [name, def] of Object.entries(entries)) {
    if (name.startsWith('$') || !def || typeof def !== 'object') continue;
    if (typeof def.ref === 'string') {
      const value = resolveRef(def.ref, `semantic.${group}.${name}`);
      if (value === null) continue;
      // Medida vem como numero cru do primitivo; sem unidade e CSS invalido e
      // a declaracao inteira e descartada em silencio pelo navegador.
      const css = typeof value === 'number' ? `${value}px` : value;
      push(`  --ah-${group}-${kebab(name)}: ${css};`);
    }
  }
}
const disabled = semantic.control?.disabled ?? {};
for (const part of ['bg', 'border', 'text']) {
  const hex = resolveRef(disabled[part]?.ref, `semantic.control.disabled.${part}`);
  if (hex) push(`  --ah-control-disabled-${part}: ${hex};`);
}
push('}');
push('');

/* ------------------------------------------------- papeis de acao (accent)
 *
 * Os papeis com `resolve` nao tem `ref`: sao ESCOLHIDOS por contraste, nao
 * apontados. O default abaixo usa a rampa do primitive.json (Ciano Arena).
 *
 * Em runtime, `getTenantTheme()` sobrescreve estes valores no atributo
 * `style` do <html> com a rampa do tenant (DS-PAINEL.md §12). O que esta aqui
 * e o fallback: uma pagina sem tema resolvido ainda renderiza acessivel, em
 * vez de cair para a cor herdada do navegador.
 */
const accentRamp = Object.fromEntries(
  Object.entries(primitive.accent)
    .filter(([k]) => !k.startsWith('$') && k !== 'seed')
    .map(([tone, def]) => [Number(tone), def.value]),
);

const tonesAsc = Object.keys(accentRamp)
  .map(Number)
  .sort((a, b) => a - b);

/** Menor tom (mais claro) que atinge o alvo. Mesmo criterio de src/accent.ts. */
function minToneWithContrast(against, target) {
  for (const tone of tonesAsc) {
    if (contrast(accentRamp[tone], against) >= target - 0.005) return tone;
  }
  return tonesAsc[tonesAsc.length - 1];
}

const solidTone = minToneWithContrast(WHITE, 4.5);
const solidIndex = tonesAsc.indexOf(solidTone);
const hoverTone = tonesAsc[Math.min(solidIndex + 1, tonesAsc.length - 1)];

const expectedSolid = semantic.action?.solid?.$expected;
if (expectedSolid && expectedSolid !== `accent.${solidTone}`) {
  errors.push(
    `acao solida resolveu para accent.${solidTone}, mas semantic.json diz ` +
      `"$expected": "${expectedSolid}". Um dos dois esta desatualizado -- e o ` +
      `documento nao pode divergir do que a tela realmente pinta.`,
  );
}

push('/* Papeis de acao: RESOLVIDOS por contraste. Runtime sobrescreve por tenant. */');
push(':root {');
push(`  --ah-action-solid: ${accentRamp[solidTone]};`);
push(`  --ah-action-on-solid: ${WHITE};`);
push(`  --ah-action-text: ${accentRamp[solidTone]};`);
push(`  --ah-action-hover: ${accentRamp[hoverTone]};`);
push(`  --ah-focus-ring: ${accentRamp[solidTone]};`);
push('  --ah-focus-ring-width: 2px;');
push('  --ah-focus-ring-offset: 2px;');
push('}');
push('');

// Camada de expressao -- por superficie.
push('/* Camada de expressao: por superficie. `data-surface` seleciona. */');
const panel = expression.panel;
push('[data-surface="panel"] {');
push(`  --ah-size-control: ${panel.size.control}px;`);
push(`  --ah-size-table-row: ${panel.size.tableRow}px;`);
push(`  --ah-size-card-padding: ${panel.size.cardPadding}px;`);
push(`  --ah-size-page-gutter: ${panel.size.pageGutter}px;`);
push(`  --ah-radius-control: ${panel.radius.control}px;`);
push(`  --ah-radius-card: ${panel.radius.card}px;`);
push(`  --ah-radius-badge: ${panel.radius.badge}px;`);
push(`  --ah-radius-modal: ${panel.radius.modal}px;`);
push('}');
push('');

/**
 * Superficie do TOTEM -- DS-TOTEM.md 2.1.
 *
 * Emitida daqui, e nao escrita a mao no app, pela mesma razao das outras: o
 * hex vive em `tokens/` e em nenhum outro lugar (regra de lint 1). O totem e
 * dark e nao compartilha papel com o painel; por isso ganha prefixo proprio
 * (`--ah-totem-*`) em vez de redefinir `--ah-text-*`, que confundiria um
 * componente do painel renderizado por engano nesta superficie.
 */
push('/* Superficie do totem: dark, leitura a 60-100 cm. DS-TOTEM.md 2.1. */');
push('[data-surface="totem"] {');
for (const [grupo, entradas] of Object.entries(totem.totem)) {
  // `accentsDerivados` sai em blocos proprios logo abaixo, um por accent.
  if (grupo === 'accentsDerivados') continue;
  for (const [nome, def] of Object.entries(entradas)) {
    if (nome.startsWith('$')) continue;
    push(`  --ah-totem-${grupo}-${nome}: ${def.value};`);
  }
}
push('}');
push('');

/**
 * Um bloco por accent NAO-AZUL -- ADR-042, Decisao 0: `aparencia.accent` e
 * configuravel, entao as quatro variantes precisam EXISTIR. Emitir so a AZUL
 * deixava o campo do contrato sem efeito nenhum na tela.
 *
 * `[data-surface="totem"][data-accent="X"]` redefine so os cinco papeis de
 * `brand`; superficie, texto e semantica seguem do bloco acima. AZUL nao
 * precisa de bloco: e o valor padrao ja emitido em `--ah-totem-brand-*`.
 */
for (const [accent, papeis] of Object.entries(totem.totem.accentsDerivados)) {
  if (accent.startsWith('$')) continue;
  push(`[data-surface="totem"][data-accent="${accent}"] {`);
  for (const [nome, def] of Object.entries(papeis)) {
    if (nome.startsWith('$')) continue;
    push(`  --ah-totem-brand-${nome}: ${def.value};`);
  }
  push('}');
  push('');
}
push('@media (prefers-reduced-motion: reduce) {');
push('  *, *::before, *::after {');
push(`    animation-duration: ${primitive.motion.reducedMotionMax}ms !important;`);
push(`    transition-duration: ${primitive.motion.reducedMotionMax}ms !important;`);
push('  }');
push('}');

const css = cssLines.join('\n') + '\n';

const ts = `/* GERADO POR scripts/build-tokens.mjs -- NAO EDITE A MAO. */
/* Fonte: packages/ui/tokens/*.json  ·  Contrato: docs/design/DS-PAINEL.md */

export const CARBON = ${JSON.stringify(
  Object.fromEntries(Object.entries(primitive.carbon).map(([k, v]) => [k, v.value])),
  null,
  2,
)} as const;

export const SEMANTIC_COLOR = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(primitive.semantic)
      .filter(([k]) => !k.startsWith('$'))
      .map(([k, v]) => [k, v.value]),
  ),
  null,
  2,
)} as const;

export const ACCENT_SEED_DEFAULT = ${JSON.stringify(primitive.accent.seed)};

export const TYPE_SCALE = ${JSON.stringify(
  Object.fromEntries(Object.entries(primitive.type).filter(([k]) => !k.startsWith('$'))),
  null,
  2,
)} as const;

export const BREAKPOINT = ${JSON.stringify(
  Object.fromEntries(Object.entries(primitive.breakpoint).filter(([k]) => !k.startsWith('$'))),
  null,
  2,
)} as const;

/**
 * Cores FIXAS de marca de terceiro -- nunca entram no CSS var do tenant nem
 * no checador de contraste (\`brand\` fica de fora do resto do pipeline de
 * proposito). Existem para um componente de logo (ex.: \`IconeWhatsApp\`)
 * usar sem hex literal cru, satisfazendo a regra de lint 1.
 */
export const BRAND = ${JSON.stringify(
  Object.fromEntries(Object.entries(primitive.brand).filter(([k]) => !k.startsWith('$'))),
  null,
  2,
)} as const;

/** Contraste efetivo de cada papel, medido no build. */
export const CONTRAST_REPORT = ${JSON.stringify(contrastReport, null, 2)} as const;
`;

/* ------------------------------------------------------------- resultado */

if (errors.length > 0) {
  process.stderr.write(`\n✗ pipeline de tokens reprovou (${errors.length}):\n\n`);
  for (const e of errors) process.stderr.write(`  · ${e}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

if (CHECK_ONLY) {
  /**
   * Compara CONTEUDO, nao bytes.
   *
   * `core.autocrlf=true` -- o padrao deste repositorio no Windows -- entrega
   * CRLF no checkout, e este script escreve LF. Sem normalizar, o `--check`
   * reprovaria todo clone no Windows enquanto passaria no Linux do CI:
   * verde remoto, vermelho local, e o desenvolvedor "regerando" um arquivo
   * que ja estava correto.
   */
  const normalize = (s) => s.replace(/\r\n/g, '\n');

  let stale = false;
  for (const [path, expected] of [
    [OUT_CSS, css],
    [OUT_TS, ts],
  ]) {
    let actual = null;
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      actual = null;
    }
    if (actual === null || normalize(actual) !== normalize(expected)) {
      process.stderr.write(
        `\n✗ ${path} esta desatualizado. Rode \`pnpm --filter @arenahub/ui build:tokens\`.\n\n`,
      );
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}

mkdirSync(dirname(OUT_CSS), { recursive: true });
writeFileSync(OUT_CSS, css, 'utf8');
writeFileSync(OUT_TS, ts, 'utf8');

process.stdout.write(
  `✓ tokens: ${contrastReport.length} pares de contraste verificados\n` +
    `  ${OUT_CSS}\n  ${OUT_TS}\n`,
);
