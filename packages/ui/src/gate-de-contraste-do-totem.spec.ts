/**
 * Canario do gate de contraste do TOTEM -- issue #230.
 *
 * O gate mora em `scripts/build-tokens.mjs` e reprova o build quando um par
 * cor/fundo do totem cai abaixo do alvo. Este arquivo prova que ele reprova
 * de verdade: cada caso planta UMA violacao no `totem.json`, roda o build e
 * exige exit != 0 com a mensagem certa.
 *
 * POR QUE UM CANARIO, e nao apenas "o build passa"
 * ------------------------------------------------
 * Guarda verde nao distingue *regra satisfeita* de *regra ausente* -- e a
 * ausencia foi o estado real ate 01/09/2026: a saida dizia "13 pares
 * verificados" e nenhum era do totem, enquanto dois tokens estavam abaixo do
 * minimo da WCAG. Um teste que so afirmasse o verde teria passado o tempo
 * todo, inclusive no dia em que a guarda nao existia.
 *
 * O caso mais valioso e o do `state`: uma cor que PASSA sobre `bg.base` puro
 * e REPROVA sobre o proprio tint de 10%. Ele so falha se o gate estiver
 * medindo contra o fundo certo -- que e a licao inteira desta issue.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PKG = join(AQUI, '..');
const TOKENS = join(PKG, 'tokens', 'totem.json');

const original = readFileSync(TOKENS, 'utf8');

/**
 * A forma MINIMA do `totem.json` que este teste precisa enxergar.
 *
 * Modelar so `value` e `contrastOnBase` mantem o canario legivel e o desacopla
 * do resto do arquivo: campo novo no JSON nao quebra este spec.
 */
interface TomDoTotem {
  value: string;
  contrastOnBase?: number;
}

type GrupoDoTotem = Record<string, TomDoTotem>;

interface DocumentoDoTotem {
  totem: Record<string, GrupoDoTotem>;
}

/** Roda o pipeline como o CI roda. Devolve o codigo e a saida junta. */
function rodarBuild(): { code: number; saida: string } {
  try {
    const saida = execFileSync('node', ['scripts/build-tokens.mjs'], {
      cwd: PKG,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, saida };
  } catch (erro) {
    const e = erro as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, saida: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * Le o tom pedido ou FALHA com o caminho na mensagem.
 *
 * Sem esta guarda, renomear um token faria o canario passar por acidente: a
 * mutacao nao aconteceria, o build ficaria verde e o teste... tambem, se
 * esperasse verde. Falhar aqui aponta o caminho errado de imediato.
 */
function tom(doc: DocumentoDoTotem, grupo: string, nome: string): TomDoTotem {
  const alvo = doc.totem[grupo]?.[nome];
  if (alvo === undefined) {
    throw new Error(`totem.json nao tem "${grupo}.${nome}" -- o canario precisa ser atualizado.`);
  }
  return alvo;
}

/** Aplica uma mutacao no `totem.json` e devolve o resultado do build. */
function comViolacao(mutar: (doc: DocumentoDoTotem) => void): { code: number; saida: string } {
  const doc = JSON.parse(original) as DocumentoDoTotem;
  mutar(doc);
  writeFileSync(TOKENS, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return rodarBuild();
}

afterEach(() => {
  // O arquivo real volta SEMPRE -- inclusive se a assercao falhar no meio.
  writeFileSync(TOKENS, original, 'utf8');
});

describe('gate de contraste do totem (#230)', () => {
  it('reprova texto abaixo de 4.5 -- WCAG 1.4.3', () => {
    const { code, saida } = comViolacao((doc) => {
      // Cinza escuro sobre carbono: 1.63 sobre `bg.base`.
      const alvo = tom(doc, 'text', 'secondary');
      alvo.value = '#3A3F47';
      alvo.contrastOnBase = 1.63;
    });

    expect(code).not.toBe(0);
    expect(saida).toContain('totem.text.secondary');
  });

  it('reprova borda abaixo de 3.0 -- WCAG 1.4.11', () => {
    const { code, saida } = comViolacao((doc) => {
      // O valor que vigorou ate o PR #232: 1.38 sobre base, 1.29 sobre surface.
      const alvo = tom(doc, 'border', 'default');
      alvo.value = '#232A3D';
      alvo.contrastOnBase = 1.38;
    });

    expect(code).not.toBe(0);
    expect(saida).toContain('totem.border.default');
  });

  /**
   * O CASO QUE JUSTIFICA O GATE INTEIRO.
   *
   * O que importa aqui nao e so a reprovacao: e a MENSAGEM citar o tint. O gate
   * tem de medir o par sobre o proprio fundo de 10%, nao sobre `bg.base` puro
   * -- medir contra o fundo puro e otimista em ~1.3 ponto, e foi assim que
   * `state.success` do painel passou com 5.08 e entregou 4.44 na tela em 18/08.
   */
  it('mede estado sobre o proprio tint de 10%, nao sobre o fundo puro', () => {
    const { code, saida } = comViolacao((doc) => {
      const alvo = tom(doc, 'state', 'success');
      alvo.value = '#1E5A33';
      alvo.contrastOnBase = 2.17;
    });

    expect(code).not.toBe(0);
    expect(saida).toContain('totem.state.success');
    expect(saida).toContain('tint');
  });

  /**
   * `contrastOnBase` e anotacao humana. Sem esta checagem ela volta a ser prosa:
   * alguem troca o hex, esquece o numero, e o JSON mente com o build verde --
   * que e exatamente como `text.tertiary` anotava 3.00 entregando 2.81 no uso
   * real.
   */
  it('reprova quando contrastOnBase diverge do calculo', () => {
    const { code, saida } = comViolacao((doc) => {
      tom(doc, 'text', 'primary').contrastOnBase = 99;
    });

    expect(code).not.toBe(0);
    expect(saida).toContain('contrastOnBase');
  });

  it('passa com os tokens reais', () => {
    const { code, saida } = rodarBuild();

    expect(code).toBe(0);
    expect(saida).toMatch(/pares de contraste verificados/);
  });
});
