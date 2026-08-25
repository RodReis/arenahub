/**
 * O resolvedor de accent e o unico ponto do design system onde a cor da
 * academia encontra a acessibilidade. Ele existe para que a promessa do
 * DS-PAINEL.md §2.3 -- "escolhe por contraste calculado, nunca por numero
 * fixo de tom" -- seja verificavel, nao apenas escrita.
 *
 * O teste que importa nao e "o Ciano Arena resolve para accent-700". E:
 * QUALQUER seed que um tenant mande produz papeis que passam no AA.
 *
 * As cores do SISTEMA vem do pipeline (`tokens.generated.ts`), nunca coladas
 * aqui. Se alguem mudar `carbon-400` no primitive.json, o teste passa a medir
 * a cor nova e denuncia; um hex repetido no spec mediria para sempre a cor
 * antiga e ficaria verde enquanto a tela real quebrava.
 */

import { describe, expect, it } from 'vitest';

import { accentCssVars, deriveRamp, RAMP_TONES, resolveAccent } from './accent.js';
import { AA_TEXT, AAA_TEXT, contrastRatio, meets, parseHex, ratio } from './contrast.js';
import fixture from './seeds.fixture.json' with { type: 'json' };
import { ACCENT_SEED_DEFAULT, CARBON, SEMANTIC_COLOR } from './tokens.generated.js';

const WHITE = fixture.branco;

/** Padrao comercial Ciano Arena, vindo do token -- nao de copia. */
const SEED = ACCENT_SEED_DEFAULT;

/** Seeds hipoteticos de tenant. Ver o `$why` do fixture. */
const SEEDS_DE_TENANT = [SEED, ...fixture.tenants.map((t) => t.seed)];

const SEEDS_EXTREMOS = fixture.gamutExtremos.map((t) => t.seed);

/** Fundo da superficie escura -- app (F43) e totem (F44) vao usar. */
const SUPERFICIE_ESCURA = CARBON[900];

describe('contraste', () => {
  it('reproduz as razoes publicadas no DS-PAINEL.md §2.1', () => {
    // Se estes numeros mudarem, o documento passou a mentir -- ou o token.
    expect(ratio(CARBON[500], WHITE)).toBe(6.56);
    expect(ratio(CARBON[400], WHITE)).toBe(3.78); // reprova como texto
    expect(ratio(CARBON[900], WHITE)).toBe(18.45);
  });

  it('confirma que carbon-400 reprova como texto de corpo', () => {
    // A regra de lint 4 inteira depende deste fato. Se um dia passar, a
    // excecao nomeada do disabled virou desnecessaria -- e alguem precisa saber.
    expect(meets(CARBON[400], WHITE, AA_TEXT)).toBe(false);
  });

  it('confirma que os semanticos fixos passam sobre o card branco', () => {
    for (const [papel, hex] of Object.entries(SEMANTIC_COLOR)) {
      expect(meets(hex, WHITE, AA_TEXT), `${papel} (${hex}) reprovou`).toBe(true);
    }
  });

  it('e simetrico na ordem dos argumentos', () => {
    const cor = SEMANTIC_COLOR.success;
    expect(contrastRatio(cor, WHITE)).toBeCloseTo(contrastRatio(WHITE, cor), 10);
  });

  it('rejeita hex invalido em vez de devolver preto', () => {
    // Devolver preto passaria no teste de contraste com folga e esconderia o
    // erro exatamente no arquivo que existe para pega-lo.
    expect(() => parseHex(fixture.formas.invalidaHex)).toThrow(/Hex invalido/);
    expect(() => parseHex(fixture.formas.invalidaTexto)).toThrow(/Hex invalido/);
  });

  it('aceita a forma curta #RGB', () => {
    expect(parseHex(fixture.formas.curtaValida)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('deriveRamp', () => {
  it('produz os 10 degraus', () => {
    expect(Object.keys(deriveRamp(SEED))).toHaveLength(RAMP_TONES.length);
  });

  it('escurece monotonicamente do 50 ao 900', () => {
    // Rampa nao-monotona quebra a premissa do resolvedor: ele varre do claro
    // ao escuro e PARA no primeiro que passa. Sem monotonia, "o menor tom que
    // atinge o alvo" deixa de significar alguma coisa.
    for (const seed of SEEDS_DE_TENANT) {
      const ramp = deriveRamp(seed);
      const ratios = RAMP_TONES.map((t) => contrastRatio(ramp[t], WHITE));

      for (let i = 1; i < ratios.length; i += 1) {
        const anterior = ratios[i - 1];
        const atual = ratios[i];
        expect(atual, `${seed}: tom ${RAMP_TONES[i]} nao escureceu`).toBeGreaterThan(
          anterior as number,
        );
      }
    }
  });

  it('produz hex valido mesmo para seeds em extremos de gamut', () => {
    for (const seed of [...SEEDS_DE_TENANT, ...SEEDS_EXTREMOS]) {
      const ramp = deriveRamp(seed);
      for (const tone of RAMP_TONES) {
        expect(ramp[tone], `${seed} tom ${tone}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
});

describe('resolveAccent', () => {
  it('resolve o padrao comercial com acao solida acessivel', () => {
    const resolved = resolveAccent(SEED);

    expect(meets(resolved.solid, WHITE, AA_TEXT)).toBe(true);
    expect(resolved.onSolid).toBe(WHITE);
    expect(resolved.report.solidOnWhite).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('resolve acao acessivel para QUALQUER seed de tenant', () => {
    // Este e o teste que justifica o resolvedor existir. Fixar accent-700
    // funcionaria para o ciano e produziria texto branco ilegivel sobre
    // amarelo -- precisamente o caso '#FFD400'.
    for (const seed of SEEDS_DE_TENANT) {
      const resolved = resolveAccent(seed);

      expect(
        meets(resolved.solid, resolved.onSolid, AA_TEXT),
        `acao solida de ${seed} reprovou: ${resolved.report.solidOnWhite}`,
      ).toBe(true);

      expect(
        meets(resolved.text, WHITE, AA_TEXT),
        `texto de acao de ${seed} reprovou: ${resolved.report.textOnSurface}`,
      ).toBe(true);
    }
  });

  it('escolhe o MENOR tom que passa, nao um numero fixo', () => {
    // "Menor" = mais claro. A marca aparece o maximo que o AA permite; o tom
    // imediatamente anterior tem de reprovar, senao o resolvedor esta sendo
    // conservador demais e comendo saturacao a toa.
    for (const seed of SEEDS_DE_TENANT) {
      const resolved = resolveAccent(seed);
      const index = RAMP_TONES.findIndex((t) => resolved.ramp[t] === resolved.solid);

      expect(index, `${seed}: solid nao esta na rampa`).toBeGreaterThan(-1);

      if (index > 0) {
        const toneAnterior = RAMP_TONES[index - 1];
        expect(
          meets(resolved.ramp[toneAnterior as (typeof RAMP_TONES)[number]], WHITE, AA_TEXT),
          `${seed}: o tom anterior tambem passa -- o resolvedor pulou cedo demais`,
        ).toBe(false);
      }
    }
  });

  it('devolve cor diferente por tenant, ainda que no mesmo degrau', () => {
    // Sutil, e vale escrever: dois seeds costumam cair no MESMO indice da
    // rampa, porque TONE_LIGHTNESS e fixa por degrau -- e de proposito, para
    // `accent-700` ter o mesmo PESO visual em qualquer tenant. Contraste
    // depende de luminosidade, entao mesmo L da mesmo degrau.
    //
    // O que muda entre tenants e a COR resolvida, nao o numero. Um teste que
    // exigisse indices diferentes reprovaria o comportamento correto.
    const amareloSeed = fixture.tenants.find((t) => t.nome === 'amarelo')?.seed;
    expect(amareloSeed).toBeDefined();

    const ciano = resolveAccent(SEED);
    const amarelo = resolveAccent(amareloSeed as string);

    expect(amarelo.solid).not.toBe(ciano.solid);
    expect(meets(amarelo.solid, WHITE, AA_TEXT)).toBe(true);
    expect(meets(ciano.solid, WHITE, AA_TEXT)).toBe(true);
  });

  it('da hover mais escuro que a acao solida', () => {
    const resolved = resolveAccent(SEED);
    expect(contrastRatio(resolved.hover, WHITE)).toBeGreaterThan(
      contrastRatio(resolved.solid, WHITE),
    );
  });

  it('usa a mesma cor para foco e texto de acao', () => {
    // DS-PAINEL.md §2.3: --ah-focus-ring e o mesmo tom do texto de acao.
    const resolved = resolveAccent(SEED);
    expect(resolved.focusRing).toBe(resolved.text);
  });

  it('resolve contra superficie escura sem fork -- F43 e F44 vao precisar', () => {
    const resolved = resolveAccent(SEED, SUPERFICIE_ESCURA);
    expect(meets(resolved.text, SUPERFICIE_ESCURA, AA_TEXT)).toBe(true);
  });
});

describe('accent do totem -- superficie escura, alvo 7:1', () => {
  // Fundo carbono do totem -- DS-TOTEM.md §2.1 (bg/base). Vem do fixture, nao
  // de literal aqui: regra de lint 1 tambem vale para spec (ver seeds.fixture.json).
  const BG_BASE = fixture.totem.bgBase;

  /**
   * Confere o TOM escolhido, nao so o contraste resultante.
   *
   * Um teste que so confere `contrastRatio(...) >= 7` passa mesmo se o alvo de
   * 7 nunca for de fato aplicado na resolucao -- foi exatamente o bug: os
   * quatro seeds do totem resolvem tao claros que ate o alvo AA (4.5) ja
   * produz contraste > 16:1 contra o carbono, entao a asserção de contraste
   * sozinha nunca reprova quando alguem esquece de passar `alvoTexto`.
   * Assertar o tom prova que `resolveAccent(seed, BG_BASE, AAA_TEXT)` de fato
   * recebeu o alvo -- ver a prova por mutacao no comentario abaixo.
   */
  it.each(fixture.totem.seeds.map((seed: string) => [seed] as const))(
    'resolve o tom que a rampa realmente atinge >= 7:1 para %s',
    (seed) => {
      const resolvido = resolveAccent(seed, BG_BASE, AAA_TEXT);
      const ramp = deriveRamp(seed);
      const tomEscolhido = RAMP_TONES.find((tone) => ramp[tone] === resolvido.text);

      // Os quatro seeds do totem sao claros o bastante para o TOM MAIS CLARO
      // da rampa (50) ja passar de 7:1 contra o carbono -- nao ha seed do
      // totem que force um tom mais escuro que 50 neste conjunto. Registrado
      // no relatorio da task: nenhum seed caiu no fallback (tom 900).
      expect(tomEscolhido, `${seed}: tom nao encontrado na rampa`).toBe(50);
      expect(
        contrastRatio(resolvido.text, BG_BASE),
        `${seed}: texto de acao contra ${BG_BASE}`,
      ).toBeGreaterThanOrEqual(AAA_TEXT);
    },
  );

});

describe('resolveAccent -- alvo de contraste e parametro, nao constante fixa', () => {
  /**
   * Prova de que `alvoTexto` de fato influencia `minToneWithContrast`, nao so
   * o limiar do `expect`.
   *
   * Os quatro seeds do totem (bloco acima) tem tom 50 tao claro contra o
   * carbono `#0A0B0D` que ele satisfaz 4.5 E 7 ao mesmo tempo -- comparar
   * AA vs AAA NELES sempre da o mesmo tom, com ou sem o bug original (que
   * ignorava o terceiro argumento). Nao e o caso certo para provar
   * parametrizacao.
   *
   * O par SEED (Ciano Arena, `#00A9B8`) x `WHITE` -- o par PADRAO do painel,
   * ja usado no resto deste arquivo -- diverge de verdade: accent-700 passa
   * em 4.5 mas nao em 7; accent-800 e o primeiro a passar em 7. Se alguem
   * reverter `alvoTexto` para uma constante fixa (o bug original), este teste
   * fica vermelho porque os dois lados colapsam no mesmo tom.
   */
  it('AAA_TEXT escolhe tom mais escuro que AA_TEXT quando os alvos realmente divergem', () => {
    const comAA = resolveAccent(SEED, WHITE, AA_TEXT);
    const comAAA = resolveAccent(SEED, WHITE, AAA_TEXT);

    const ramp = deriveRamp(SEED);
    const indiceAA = RAMP_TONES.indexOf(
      RAMP_TONES.find((t) => ramp[t] === comAA.text) as (typeof RAMP_TONES)[number],
    );
    const indiceAAA = RAMP_TONES.indexOf(
      RAMP_TONES.find((t) => ramp[t] === comAAA.text) as (typeof RAMP_TONES)[number],
    );

    expect(comAAA.text, 'AAA deveria escolher um tom diferente de AA neste par').not.toBe(
      comAA.text,
    );
    expect(indiceAAA, 'AAA deveria escolher tom mais escuro (indice maior) que AA').toBeGreaterThan(
      indiceAA,
    );
    expect(meets(comAAA.text, WHITE, AAA_TEXT)).toBe(true);
    expect(meets(comAA.text, WHITE, AAA_TEXT), 'o tom de AA nao deveria bastar para AAA').toBe(
      false,
    );
  });

  it('surface default continua AA_TEXT -- retrocompatibilidade do painel', () => {
    // `resolveAccent(seed)` sem terceiro argumento tem de continuar
    // resolvendo exatamente como antes desta mudanca: admin-web nao muda.
    const semAlvoExplicito = resolveAccent(SEED);
    const comAlvoExplicitoAA = resolveAccent(SEED, WHITE, AA_TEXT);

    expect(semAlvoExplicito.text).toBe(comAlvoExplicitoAA.text);
    expect(semAlvoExplicito.solid).toBe(comAlvoExplicitoAA.solid);
  });
});

describe('accentCssVars', () => {
  it('emite os papeis do DS-PAINEL.md §2.3', () => {
    const vars = accentCssVars(resolveAccent(SEED));

    for (const papel of [
      '--ah-action-solid',
      '--ah-action-on-solid',
      '--ah-action-text',
      '--ah-action-hover',
      '--ah-action-subtle-bg',
      '--ah-focus-ring',
    ]) {
      expect(vars, papel).toHaveProperty(papel);
    }
  });

  it('emite os 10 tons da rampa para o runtime do tenant', () => {
    const vars = accentCssVars(resolveAccent(SEED));
    for (const tone of RAMP_TONES) {
      expect(vars[`--ah-accent-${tone}`]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
