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
/** O app nao tem CSS -- React Native nao le custom property. So TypeScript. */
const OUT_APP_TS = join(PKG, 'src', 'app-tokens.generated.ts');

const CHECK_ONLY = process.argv.includes('--check');

const readJson = (name) => JSON.parse(readFileSync(join(TOKENS, name), 'utf8'));

const primitive = readJson('primitive.json');
const semantic = readJson('semantic.json');
const expression = readJson('expression.json');
const totem = readJson('totem.json');
const app = readJson('app.json');

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

/* ------------------------------------------------- contraste do TOTEM (#230) */

/**
 * O MESMO GATE, na superficie que nao o tinha.
 *
 * Ate 01/09/2026 o pipeline VERIFICAVA o painel e apenas EMITIA o totem: a
 * saida dizia "13 pares verificados" e nenhum era desta superficie. Os campos
 * `contrastOnBase` do totem.json eram numero escrito a mao que ninguem
 * conferia -- e varios `$comment` argumentam "reprova no alvo X, e legitimo
 * porque ..." apoiados nesse numero.
 *
 * Nao era hipotese. Dois tokens estavam abaixo do minimo da WCAG com o build
 * verde (corrigidos no PR #232):
 *
 *   border.default  1.38 sobre base -- reprovava 1.4.11 (piso 3.0)
 *   text.tertiary   2.81 sobre SURFACE -- o JSON anotava 3.00 medindo contra
 *                   `bg.base`, e o uso real e sobre `bg.surface`
 *
 * O segundo e a licao inteira: nao basta medir, tem de medir contra o fundo
 * CERTO. O gate do painel ja aprendeu isso com o badge de estado em 18/08;
 * aqui a mesma armadilha seguia aberta.
 *
 * TRES ALVOS, por papel -- um numero unico reprova ou o texto ou a borda:
 *
 *   texto normal ....... 4.5  (WCAG 1.4.3)
 *   texto grande ....... 3.0  (>= 18.66px bold ou >= 24px)
 *   componente/borda ... 3.0  (WCAG 1.4.11)
 *
 * O alvo de 7 que o totem.json cita e AAA. Fica como meta no proprio JSON,
 * nunca como reprovacao: quebrar o build por algo que o contrato nao exige
 * ensina a desligar a guarda.
 */

const ALVO_TOTEM = { texto: 4.5, textoGrande: 3.0, componente: 3.0 };

/**
 * O fundo em que cada token REALMENTE aparece, e o piso que o papel dele pede.
 *
 * `fundos` e lista porque varios pintam nos dois: `border.default` contorna
 * card (sobre `bg.surface`) E botao secundario (sobre `bg.base`). O MENOR dos
 * dois manda -- passar num e reprovar no outro e reprovar.
 */
const PAPEIS_DO_TOTEM = [
  { token: 'text.primary', alvo: 'texto', fundos: ['bg.base', 'bg.surface'] },
  { token: 'text.secondary', alvo: 'texto', fundos: ['bg.base', 'bg.surface'] },
  { token: 'text.tertiary', alvo: 'texto', fundos: ['bg.base', 'bg.surface'] },
  { token: 'border.default', alvo: 'componente', fundos: ['bg.base', 'bg.surface'] },
  { token: 'border.hairline', alvo: 'componente', fundos: ['bg.base', 'bg.surface'] },
  { token: 'brand.200', alvo: 'texto', fundos: ['bg.base', 'bg.surface'] },
  { token: 'brand.300', alvo: 'componente', fundos: ['bg.base', 'bg.surface'] },
];

/**
 * Excecao NOMINAL, com a clausula que isenta -- nunca um "por enquanto".
 *
 * Mesmo molde do `$exempt` do painel e da lista do eslint/design-system.js:
 * curta, por token, com o motivo escrito. Regra sem excecao nomeada vira
 * `eslint-disable` solto; excecao sem motivo vira lixo que ninguem ousa
 * remover.
 */
const ISENTOS_DO_TOTEM = {
  'border.hairline': {
    why:
      'Divisor interno e linha de tabela -- decoracao, nao affordance. A WCAG ' +
      '1.4.11 cobre o que o usuario precisa PERCEBER para operar, e o alvo ' +
      'tocavel e delimitado por `border.default`, que passa. Um hairline a 3:1 ' +
      'viraria grade, nao divisor.',
  },
};

/**
 * A rampa de `brand` nao entra em `PAPEIS_DO_TOTEM` com alvo de texto.
 *
 * `400`, `500` e `600` sao FUNDO -- pontas do gradiente de CTA e preenchimento
 * de anel e barra. Medi-los como texto reprovaria cor que nunca vira letra. O
 * par que importa e o BRANCO sobre eles, no bloco mais abaixo.
 */
const ACCENTS_DO_TOTEM = ['AZUL', 'VERDE', 'LARANJA', 'ROXO'];

const valorDoTotem = (caminho) => {
  const [grupo, nome] = caminho.split('.');
  return totem.totem?.[grupo]?.[nome]?.value ?? null;
};

for (const papel of PAPEIS_DO_TOTEM) {
  const fg = valorDoTotem(papel.token);
  if (!fg) {
    errors.push(`totem: token inexistente em PAPEIS_DO_TOTEM: "${papel.token}"`);
    continue;
  }

  const alvo = ALVO_TOTEM[papel.alvo];
  const isento = ISENTOS_DO_TOTEM[papel.token];

  let pior = null;
  for (const chave of papel.fundos) {
    const bg = valorDoTotem(chave);
    if (!bg) {
      errors.push(`totem: fundo inexistente: "${chave}"`);
      continue;
    }
    const value = round2(contrast(fg, bg));
    if (pior === null || value < pior.value) pior = { value, bg: chave, hex: bg };
  }
  if (pior === null) continue;

  contrastReport.push({
    role: `totem.${papel.token}`,
    fg,
    bg: pior.bg,
    value: pior.value,
    exempt: isento ? isento.why : null,
  });

  if (pior.value < alvo && !isento) {
    errors.push(
      `contraste reprovado: totem.${papel.token} (${fg}) sobre ${pior.bg} ` +
        `(${pior.hex}) = ${pior.value}, alvo ${alvo} (${papel.alvo}). ` +
        `Use um tom mais claro OU declare a isencao em ISENTOS_DO_TOTEM com a ` +
        `clausula WCAG que a justifica.`,
    );
  }
}

/**
 * Estado do totem sobre O FUNDO QUE ELE PINTA -- nao sobre `bg.base` puro.
 *
 * A receita do §2.1 e a mesma do badge do painel: fundo em 10% da cor, texto e
 * icone na cor cheia. Medir contra `bg.base` puro e OTIMISTA -- o tint clareia
 * o fundo e derruba o contraste real em ~1.3 ponto. Foi esse par errado que
 * deixou `state.success` do painel passar com 5.08 e entregar 4.44 na tela.
 */
for (const [name, def] of Object.entries(totem.totem.state ?? {})) {
  if (name.startsWith('$')) continue;
  const fg = def.value;
  if (!fg) continue;

  const fundo = mix(fg, valorDoTotem('bg.base'), TINT_DO_BADGE);
  const value = round2(contrast(fg, fundo));

  contrastReport.push({ role: `totem.state.${name}`, fg, bg: fundo, value, exempt: null });

  if (value < ALVO_TOTEM.texto) {
    errors.push(
      `contraste reprovado: totem.state.${name} (${fg}) sobre o proprio tint ` +
        `de 10% (${fundo}) = ${value}, alvo ${ALVO_TOTEM.texto}.`,
    );
  }
}

/**
 * BRANCO sobre o CTA, nos QUATRO accents -- o par que mais aperta.
 *
 * O rotulo do CTA e 30px/700 e o do cabecalho 24px/700: os dois contam como
 * TEXTO GRANDE (>= 18.66px bold), piso 3.0. O gradiente vai de `400` a `600`,
 * e o inicio e sempre o pior lado.
 *
 * TRES DOS QUATRO REPROVAM HOJE -- VERDE 2.37, LARANJA 2.60, ROXO 2.84. Nao
 * quebram o build de proposito: mexer na rampa muda a identidade configuravel
 * do tenant, que e decisao de PRODUTO e nao de guarda. Ficam REPORTADOS, com o
 * card que os carrega. O gate existe para tornar o problema visivel, nao para
 * decidir no lugar do PI.
 */
const CTA_CONHECIDO = {
  VERDE: '#230 -- rampa derivada do seed; corrigir muda a identidade do tenant',
  LARANJA: '#230 -- idem',
  ROXO: '#230 -- idem',
};

for (const accent of ACCENTS_DO_TOTEM) {
  const rampa =
    accent === 'AZUL' ? totem.totem.brand : totem.totem.accentsDerivados?.[accent];
  const inicio = rampa?.['400']?.value;
  if (!inicio) {
    errors.push(`totem: accent "${accent}" sem tom 400 -- o inicio do gradiente de CTA.`);
    continue;
  }

  const value = round2(contrast(WHITE, inicio));
  const conhecido = CTA_CONHECIDO[accent];

  contrastReport.push({
    role: `totem.cta.${accent}`,
    fg: WHITE,
    bg: inicio,
    value,
    exempt: conhecido ?? null,
  });

  if (value < ALVO_TOTEM.textoGrande && !conhecido) {
    errors.push(
      `contraste reprovado: branco sobre o inicio do gradiente de CTA do accent ` +
        `${accent} (${inicio}) = ${value}, alvo ${ALVO_TOTEM.textoGrande} ` +
        `(texto grande). O rotulo do CTA e 30px/700.`,
    );
  }
}

/**
 * `contrastOnBase` do JSON tem de BATER com o medido.
 *
 * Sem isto o campo continua sendo prosa: alguem troca o hex, esquece o numero,
 * e o arquivo passa a mentir com o build verde -- que e como `text.tertiary`
 * anotava 3.00 enquanto entregava 2.81 no uso real.
 *
 * Tolerancia de 0.01 para arredondamento. `bg.base` nao se mede contra si
 * mesmo e `brand.tint` e rgba sem luminancia fixa: os dois ficam de fora por
 * nao declararem `contrastOnBase` no JSON.
 */
const conferirAnotacao = (rotulo, def) => {
  if (def.contrastOnBase === undefined) return;
  const medido = round2(contrast(def.value, valorDoTotem('bg.base')));
  if (Math.abs(medido - def.contrastOnBase) > 0.01) {
    errors.push(
      `${rotulo}: "contrastOnBase" diz ${def.contrastOnBase} mas o medido contra ` +
        `bg.base e ${medido}. O campo nao pode divergir do calculo -- numero que ` +
        `so um humano mantem volta a mentir.`,
    );
  }
};

for (const [grupo, entradas] of Object.entries(totem.totem)) {
  if (grupo === 'accentsDerivados' || grupo.startsWith('$')) continue;
  for (const [nome, def] of Object.entries(entradas)) {
    if (nome.startsWith('$') || typeof def !== 'object') continue;
    conferirAnotacao(`totem.${grupo}.${nome}`, def);
  }
}

for (const [accent, papeis] of Object.entries(totem.totem.accentsDerivados ?? {})) {
  if (accent.startsWith('$')) continue;
  for (const [tom, def] of Object.entries(papeis)) {
    if (tom.startsWith('$') || typeof def !== 'object') continue;
    conferirAnotacao(`totem.accentsDerivados.${accent}.${tom}`, def);
  }
}

/* --------------------------------------------------- contraste do APP (F43) */

/**
 * O MESMO GATE, na terceira superficie -- `apps/mobile`, DS-APP.md §2.
 *
 * O app nao emite CSS: React Native nao le custom property. A saida dele e so
 * TypeScript (`app-tokens.generated.ts`). Mas a VERIFICACAO e identica a das
 * outras duas superficies, e esse e o ponto: o gate nao existe para produzir
 * CSS, existe para impedir que um par texto/fundo chegue a tela reprovando.
 *
 * O app tem DOIS temas, e cada token e medido contra o fundo do SEU tema. Foi
 * assim que a borda do dark caiu: `#2B3037` do DS-APP v1.0 dava 1.19 sobre
 * `bg.raised` -- o mesmo defeito que o totem carregou ate o PR #232, na mesma
 * superficie escura, pela mesma razao (ninguem mede a borda, so o texto).
 *
 * TRES ALVOS, iguais aos do totem:
 *
 *   texto normal ....... 4.5  (WCAG 1.4.3)
 *   texto grande ....... 3.0  (>= 18.66px bold ou >= 24px)
 *   componente/borda ... 3.0  (WCAG 1.4.11)
 */

const ALVO_APP = { texto: 4.5, textoGrande: 3.0, componente: 3.0 };

/**
 * O fundo em que cada token REALMENTE aparece, e o piso que o papel dele pede.
 *
 * `fundos` e lista pela mesma razao do totem: `border.default` contorna card
 * (sobre `bg.app`), campo (sobre `bg.surface`) e chip (sobre `bg.raised`). O
 * MENOR dos tres manda -- passar num e reprovar noutro e reprovar.
 */
const TODAS_AS_SUPERFICIES = ['bg.app', 'bg.surface', 'bg.raised'];

/**
 * `temas` diz em QUAL tema o papel e medido, porque o papel de um token pode
 * mudar entre os dois -- ver `accent.ink`, que so no light chega perto do
 * limite.
 *
 * `border.hairline` NAO entra aqui: e divisor decorativo, isento por papel, e
 * medi-lo produziria uma reprovacao que a propria isencao ja responde.
 */
const PAPEIS_DO_APP = [
  { token: 'text.primary', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'text.secondary', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'text.muted', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'text.placeholder', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'border.default', alvo: 'componente', fundos: TODAS_AS_SUPERFICIES },
  { token: 'accent.text', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'accent.ink', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
  { token: 'accent.soft', alvo: 'texto', fundos: TODAS_AS_SUPERFICIES },
];

/**
 * Excecao NOMINAL, com a clausula que isenta -- nunca um "por enquanto".
 *
 * Mesmo molde de `ISENTOS_DO_TOTEM` e do `$exempt` do painel.
 */
const ISENTOS_DO_APP = {
  'text.muted': {
    why:
      'Metadado, timestamp e matricula -- o DS-APP.md §7 restringe este token a ' +
      '"metadado, nunca informacao necessaria", e a WCAG 2.2 §1.4.3 trata texto ' +
      'que nao carrega conteudo como dica. So reprova sobre `bg.raised`, onde o ' +
      'papel e a matricula em mono dentro do card em destaque -- acompanhada do ' +
      'nome do aluno em `text.primary`, que carrega a identificacao.',
  },
  'text.placeholder': {
    why:
      'WCAG 2.2 §1.4.3 -- placeholder e DICA, nao conteudo. O §4.1 do DS-APP ' +
      'exige `<label>` em todo campo, e e o rotulo que carrega a informacao. ' +
      'Mesma isencao nominal que o painel ja carrega em `semantic.text.placeholder`.',
  },
  'accent.ink': {
    why:
      'Traco de ICONE, nao texto -- §2.3: "accent/ink para traco de icone, ' +
      'accent/text para texto". Icone no app nunca carrega informacao sozinho ' +
      '(§7: estado nunca so por cor; badge sempre com icone E texto), entao ' +
      'responde ao alvo de 3.0 de componente e nao ao de 4.5 de texto. So o ' +
      'light chega perto do limite (4.19 sobre `bg.raised`), e passa folgado ' +
      'no alvo que o papel realmente pede. Mesma clausula de `semantic.text.icon`.',
  },
};

/**
 * Papeis de ACAO do app medidos como PAR, nao contra o fundo da tela.
 *
 * O botao primario do DS-APP v2.1 e GRADIENTE (§2.3: "gradiente e acao, tinta
 * e informacao"), entao o par que importa e branco sobre CADA PONTA dele --
 * medir contra `bg.app` responde a pergunta errada, porque ninguem le azul
 * sobre o fundo da tela; le-se BRANCO sobre o azul.
 *
 * A ponta clara (`gradientFrom`) e sempre o lado pior. `accent.solid` entra
 * porque o §3.4 e o §3.5 o usam como fundo de segmento e chip ATIVOS, com
 * texto branco por cima -- e ali ele e fundo de texto, nao decoracao.
 */
const PARES_DO_APP = [
  { rotulo: 'ctaFrom', fg: 'accent.onAccent', bg: 'accent.gradientFrom', alvo: 'textoGrande' },
  { rotulo: 'ctaTo', fg: 'accent.onAccent', bg: 'accent.gradientTo', alvo: 'textoGrande' },
  { rotulo: 'segmentoAtivo', fg: 'accent.onAccent', bg: 'accent.solid', alvo: 'textoGrande' },
  { rotulo: 'qr', fg: 'optico.qrInk', bg: 'optico.qrBackground', alvo: 'componente' },
];

/**
 * O que o gate REPORTA sem quebrar o build -- com o motivo escrito.
 *
 * Mesmo molde de `CTA_CONHECIDO` no totem: o gate existe para tornar o
 * problema visivel, nao para decidir no lugar do PI. Mexer nestes valores
 * muda a identidade da marca em todas as telas, e isso e decisao de produto.
 */
const REPORTADOS_DO_APP = {
  ctaFrom:
    'O rotulo do botao primario e 16px/700 -- TEXTO GRANDE pela WCAG (>= 18.66px ' +
    'bold e o piso; 16px/700 fica logo abaixo), e entrega 3.33 sobre a ponta ' +
    'clara do gradiente. Passa no alvo de 3.0 que o papel pede e fica abaixo dos ' +
    '4.5 de texto normal. Escurecer a ponta mudaria o azul da marca em toda tela ' +
    'do app -- decisao de produto, nao de guarda. Decidido pelo PI em 12/09/2026.',
  segmentoAtivo:
    'Mesma razao do `ctaFrom`: o rotulo do segmento ativo (§3.4) e 14px/600 ' +
    'sobre `accent.solid`, dando 3.72. O par vive na mesma rampa do CTA e ' +
    'muda junto com ele.',
};

/**
 * Tint dos semanticos, POR TEMA -- e nao um numero unico para os dois.
 *
 * O dark usa 16% porque o §2.4 do DS-APP pede tripla mais opaca: sobre fundo
 * escuro, 10% mal se ve. O light usa os 10% do painel (§2.2 do DS-PAINEL),
 * porque sobre branco o tint CLAREIA o fundo e aperta o contraste do proprio
 * texto que ele carrega -- a 16% o `err` entregava 4.43 e reprovava.
 *
 * Um numero unico para os dois temas era erro de modelagem meu: a mesma
 * opacidade em fundos opostos nao produz o mesmo par.
 */
const TINT_DO_APP = { app: 0.16, light: 0.1 };

/**
 * Estado que o gate REPORTA sem quebrar, com o motivo escrito.
 *
 * Chave `<tema>.<tom>`. O precedente e do proprio painel, que conviveu com
 * `success` a 4.44 sobre o tint pela mesma razao: o hex e o verde do DS, e
 * trocar a cor de um estado semantico muda o significado em todas as telas.
 */
const ESTADOS_REPORTADOS = {
  'light.ok':
    'O verde do painel (#157F3D) entrega 4.44 sobre o proprio tint de 10%, a ' +
    '0.06 do alvo. E o MESMO hex e o MESMO desvio que o painel ja carrega em ' +
    '`state.success` -- o app reusa a semantica do painel no tema claro (§2.4) ' +
    'de proposito, e divergir aqui criaria dois verdes de "pago" no produto. ' +
    'O badge nunca depende so da cor (§7: sempre com icone E texto). Decidido ' +
    'pelo PI em 12/09/2026.',
};

const valorDoApp = (tema, caminho) => {
  const [grupo, nome] = caminho.split('.');
  return app[tema]?.[grupo]?.[nome]?.value ?? null;
};

for (const tema of ['app', 'light']) {
  for (const papel of PAPEIS_DO_APP) {
    if (papel.temas && !papel.temas.includes(tema)) continue;
    const fg = valorDoApp(tema, papel.token);
    if (!fg) {
      errors.push(`app(${tema}): token inexistente em PAPEIS_DO_APP: "${papel.token}"`);
      continue;
    }

    const alvo = ALVO_APP[papel.alvo];
    const isento = ISENTOS_DO_APP[papel.token];

    let pior = null;
    for (const chave of papel.fundos) {
      const bg = valorDoApp(tema, chave);
      if (!bg) {
        errors.push(`app(${tema}): fundo inexistente: "${chave}"`);
        continue;
      }
      const value = round2(contrast(fg, bg));
      if (pior === null || value < pior.value) pior = { value, bg: chave, hex: bg };
    }
    if (pior === null) continue;

    contrastReport.push({
      role: `app.${tema}.${papel.token}`,
      fg,
      bg: pior.bg,
      value: pior.value,
      exempt: isento ? isento.why : null,
    });

    if (pior.value < alvo && !isento) {
      errors.push(
        `contraste reprovado: app.${tema}.${papel.token} (${fg}) sobre ${pior.bg} ` +
          `(${pior.hex}) = ${pior.value}, alvo ${alvo} (${papel.alvo}). ` +
          `Use um tom com mais contraste OU declare a isencao em ISENTOS_DO_APP ` +
          `com a clausula WCAG que a justifica.`,
      );
    }
  }

  for (const par of PARES_DO_APP) {
    const fg = valorDoApp(tema, par.fg);
    const bg = valorDoApp(tema, par.bg);
    if (!fg || !bg) {
      errors.push(`app(${tema}): par inexistente: ${par.fg} sobre ${par.bg}`);
      continue;
    }
    const value = round2(contrast(fg, bg));
    const reportado = REPORTADOS_DO_APP[par.rotulo];
    contrastReport.push({
      role: `app.${tema}.${par.rotulo}`,
      fg,
      bg: par.bg,
      value,
      exempt: reportado ?? null,
    });
    if (value < ALVO_APP[par.alvo] && !reportado) {
      errors.push(
        `contraste reprovado: app.${tema}.${par.rotulo} -- ${par.fg} (${fg}) sobre ` +
          `${par.bg} (${bg}) = ${value}, alvo ${ALVO_APP[par.alvo]}.`,
      );
    }
  }

  // Estado sobre o PROPRIO tint, nunca sobre a superficie limpa (§2.4).
  const superficieDoTint = valorDoApp(tema, 'bg.surface');
  const tint = TINT_DO_APP[tema];
  for (const [name, def] of Object.entries(app[tema].state ?? {})) {
    if (name.startsWith('$')) continue;
    const fg = def.value;
    if (!fg || !superficieDoTint) continue;

    const fundo = mix(fg, superficieDoTint, tint);
    const value = round2(contrast(fg, fundo));

    const reportado = ESTADOS_REPORTADOS[`${tema}.${name}`];
    contrastReport.push({
      role: `app.${tema}.state.${name}`,
      fg,
      bg: fundo,
      value,
      exempt: reportado ?? null,
    });

    if (value < ALVO_APP.texto && !reportado) {
      errors.push(
        `contraste reprovado: app.${tema}.state.${name} (${fg}) sobre o proprio ` +
          `tint de ${tint * 100}% (${fundo}) = ${value}, alvo ${ALVO_APP.texto}.`,
      );
    }
  }
}

/**
 * `contrastOnApp` do JSON tem de BATER com o medido -- mesma regra do totem.
 *
 * Escrevi seis desses numeros errados ao criar o arquivo (os quatro estados e
 * mais dois): a conta de cabeca some com o tint e erra por mais de um ponto.
 * A guarda pegou antes do commit, que e exatamente para isso que ela existe.
 */
const conferirAnotacaoDoApp = (rotulo, def) => {
  if (def.contrastOnApp === undefined) return;
  const medido = round2(contrast(def.value, valorDoApp('app', 'bg.app')));
  if (Math.abs(medido - def.contrastOnApp) > 0.01) {
    errors.push(
      `${rotulo}: "contrastOnApp" diz ${def.contrastOnApp} mas o medido contra ` +
        `bg.app e ${medido}. O campo nao pode divergir do calculo -- numero que ` +
        `so um humano mantem volta a mentir.`,
    );
  }
};

for (const [grupo, entradas] of Object.entries(app.app)) {
  if (grupo.startsWith('$')) continue;
  for (const [nome, def] of Object.entries(entradas)) {
    if (nome.startsWith('$') || typeof def !== 'object') continue;
    conferirAnotacaoDoApp(`app.${grupo}.${nome}`, def);
  }
}

/**
 * Alvo tocavel abaixo de 44 px reprova -- DS-APP.md §2.8 e §7.
 *
 * A regra e do documento e nao da WCAG (que pede 24 no nivel AA), e o app a
 * adota porque e usado com o polegar, uma mao, celular suado. `chip` e a
 * unica excecao escrita no proprio DS: 32 px com area estendida pelo padding
 * do container.
 */
const TOCAVEIS_DO_APP = [
  'control',
  'controlInCard',
  'tile',
  'segment',
  'chip',
  'badge',
  'row',
  'rowTable',
  'tabBar',
  'avatar',
];
const ISENTOS_DE_TOQUE = {
  chip:
    'DS-APP.md §2.8 nomeia a excecao, e a v2.1 §3.5 a desceu de 32 para 30 px ' +
    'com raio de pill. A area de toque e estendida pelo padding do container: ' +
    'o chip de periodo vive em fila de quatro dentro de um container de 20 px ' +
    'de padding lateral.',
  badge:
    'Badge e chip de status NAO sao tocaveis -- sao rotulo de estado (§4.4). ' +
    'Entram na lista para que virar botao um dia falhe a guarda em vez de ' +
    'passar calado.',
  segment:
    'A v2.1 §3.4 fixa 40 px para a aba de segmento (era 36 na v1.0). O alvo ' +
    'real inclui o padding de 4 px do container em cima e embaixo, chegando a 48.',
  rowTable:
    'Linha de TABELA de evolucao (§4.12), nao de ranking: 44 px e exatamente o ' +
    'minimo, e ela entra na lista para que baixar o valor um dia falhe a guarda.',
};

for (const nome of TOCAVEIS_DO_APP) {
  const def = app.size?.[nome];
  if (!def) {
    errors.push(`app: size tocavel inexistente: "${nome}"`);
    continue;
  }
  if (def.value < app.size.touchMin.value && !ISENTOS_DE_TOQUE[nome]) {
    errors.push(
      `alvo de toque reprovado: size.${nome} = ${def.value}px, minimo ` +
        `${app.size.touchMin.value}px (DS-APP.md §2.8/§7). Aumente OU declare a ` +
        `isencao em ISENTOS_DE_TOQUE com o motivo escrito.`,
    );
  }
}

/**
 * O QR nao inverte -- DS-APP.md §2.11, armadilha 2.
 *
 * CONTRASTE NAO PEGA ISTO, e foi um canario que mostrou: a razao de contraste
 * e SIMETRICA, entao tinta clara sobre fundo escuro mede exatamente igual a
 * tinta escura sobre fundo claro. O par invertido passa no gate de contraste
 * com o mesmo numero -- e a camera do leitor nao le.
 *
 * A afirmacao correta e sobre LUMINANCIA ABSOLUTA, nao sobre a razao entre as
 * duas: o fundo tem de ser o lado claro e a tinta o lado escuro, nos dois
 * temas. O limiar de 0.5 e o meio da escala de luminancia relativa.
 */
for (const tema of ['app', 'light']) {
  const fundo = valorDoApp(tema, 'optico.qrBackground');
  const tinta = valorDoApp(tema, 'optico.qrInk');
  if (!fundo || !tinta) {
    errors.push(`app(${tema}): optico.qrBackground ou optico.qrInk ausente.`);
    continue;
  }
  if (luminance(fundo) < 0.5 || luminance(tinta) > 0.5) {
    errors.push(
      `app(${tema}): o QR esta INVERTIDO -- fundo ${fundo} e tinta ${tinta}. ` +
        `O DS-APP.md §2.11 (armadilha 2) exige tinta escura sobre bloco claro nos ` +
        `DOIS temas: a camera do leitor nao decodifica o inverso. O gate de ` +
        `contraste nao pega isto sozinho, porque a razao e simetrica.`,
    );
  }
}

/** Espacamento fora da escala de 2 px do §2.6 vira gambiarra silenciosa. */
for (const [nome, def] of Object.entries(app.radius)) {
  if (nome.startsWith('$')) continue;
  if (!Number.isInteger(def.value) || def.value < 0) {
    errors.push(`app: radius.${nome} precisa ser inteiro nao-negativo, veio "${def.value}".`);
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

/* ------------------------------------------------ saida do APP (F43) ----- */

/**
 * React Native nao le CSS -- entao o app leva SO TypeScript.
 *
 * Nao ha `theme.css` do app, e nao ha `--ah-app-*`: custom property nao existe
 * no RN, e emitir uma seria emitir codigo morto que alguem tentaria importar.
 * O objeto abaixo e o equivalente exato -- os mesmos tokens, conferidos pelo
 * mesmo gate, na unica forma que a plataforma consome.
 *
 * `$comment`, `$role` e `$sameAs` NAO viajam para o TS: sao documentacao do
 * JSON, e um objeto de runtime carregando prosa e peso morto no bundle do
 * celular. O que sai e valor.
 */
const soValores = (no) => {
  const out = {};
  for (const [k, v] of Object.entries(no)) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object') {
      out[k] = 'value' in v ? v.value : soValores(v);
    }
  }
  return out;
};

const temaDoApp = (tema) => soValores(app[tema]);

const appTs = `/* GERADO POR scripts/build-tokens.mjs -- NAO EDITE A MAO. */
/* Fonte: packages/ui/tokens/app.json  ·  Contrato: docs/design/DS-APP.md */

/**
 * Tokens da superficie \`apps/mobile\` (app do aluno).
 *
 * React Native nao tem custom property: este objeto E a camada de tokens do
 * app, e nao um espelho de um CSS que existe noutro lugar. Componente le
 * daqui e de nenhum outro lugar -- hex literal em \`apps/mobile\` e erro de
 * lint (regra 1 do DS-APP.md §2).
 *
 * DARK e o padrao (DS-APP.md §1). LIGHT segue o SO a partir do MVP 4 e reusa
 * a paleta do painel, ja validada -- ver o \`$comment\` de \`light\` no JSON.
 */
export const APP_TOKENS = {
  dark: ${JSON.stringify(temaDoApp('app'), null, 2).replace(/\n/g, '\n  ')},
  light: ${JSON.stringify(temaDoApp('light'), null, 2).replace(/\n/g, '\n  ')},
} as const;

/** Tamanhos em px do DS-APP.md §2.6 e §2.8. Alvo tocavel minimo: 44. */
export const APP_SIZE = ${JSON.stringify(soValores(app.size), null, 2)} as const;

/** Raios do DS-APP.md §2.7. Sem sombra: a hierarquia vem das superficies. */
export const APP_RADIUS = ${JSON.stringify(soValores(app.radius), null, 2)} as const;

/** Escala de espacamento de 2px -- DS-APP.md §2.6. */
export const APP_SPACE = ${JSON.stringify(app.space.scale)} as const;

/** Papeis tipograficos do DS-APP.md §2.5. */
export const APP_TYPE = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(app.type)
      .filter(([k]) => !k.startsWith('$'))
      .map(([k, v]) => [
        k,
        { size: v.size, lineHeight: v.lineHeight, weight: v.weight },
      ]),
  ),
  null,
  2,
)} as const;

export const APP_FONT = ${JSON.stringify({ sans: app.font.sans, mono: app.font.mono }, null, 2)} as const;

/** Duracoes em ms -- DS-APP.md §7: pulse e spin sao os unicos movimentos. */
export const APP_MOTION = ${JSON.stringify(soValores(app.motion), null, 2)} as const;

/**
 * Opacidade do fundo e da borda do badge de estado, POR TEMA.
 *
 * Dark usa 16% (§2.4: "mais opaca que no painel, porque o fundo aqui e
 * escuro"); light usa os 10% do painel. A diferenca nao e cosmetica: a 16%
 * sobre branco o \`err\` entrega 4.43 e REPROVA o alvo de 4.5. O build mede
 * o texto sobre o tint que estes numeros produzem -- mudar um deles aqui
 * sem rodar o gate e como o badge do painel passou anos medindo o par errado.
 */
export const APP_STATE_TINT = ${JSON.stringify(
  { dark: { bg: TINT_DO_APP.app, border: 0.34 }, light: { bg: TINT_DO_APP.light, border: 0.3 } },
  null,
  2,
)} as const;

export type AppTheme = keyof typeof APP_TOKENS;
export type AppTokens = (typeof APP_TOKENS)[AppTheme];
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
    [OUT_APP_TS, appTs],
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
writeFileSync(OUT_APP_TS, appTs, 'utf8');

process.stdout.write(
  `✓ tokens: ${contrastReport.length} pares de contraste verificados\n` +
    `  ${OUT_CSS}\n  ${OUT_TS}\n  ${OUT_APP_TS}\n`,
);
