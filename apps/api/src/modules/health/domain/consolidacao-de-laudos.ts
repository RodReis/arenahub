import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import { converterParaCanonica, type TipoDeMedida } from './medida.js';
import type { CampoExtraido } from './revisao-de-importacao.js';

/**
 * Consolidação dos laudos da MESMA medição (spec §3.3).
 *
 * Funções puras: sem banco, sem relógio, sem rede.
 *
 * ---------------------------------------------------------------------------
 * A ASSIMETRIA É DELIBERADA: ERRAR PARA O LADO DE MOSTRAR.
 * ---------------------------------------------------------------------------
 *
 * Fundir dois valores que divergem ESCONDE do professor que a balança
 * exportou errado — e o número errado vira histórico com selo de confirmado
 * por dois arquivos. Mostrar divergência que era só arredondamento custa um
 * clique. Por isso a tolerância é apertada: o erro barato é o preferido.
 */

/**
 * Quanto dois valores podem diferir e ainda serem "o mesmo".
 *
 * Deriva da PRECISÃO IMPRESSA no laudo, não de palpite: a balança escreve
 * peso com 2 casas (92,25) e o app com 1 (92,3), então meio décimo cobre o
 * arredondamento e nada mais. Percentual é impresso com 1 casa, mas a escala
 * de gordura corporal é mais sensível a erro de digitação — tolerância
 * menor que a de massa.
 */
export function toleranciaDe(tipo: TipoDeMedida): number {
  if (tipo === 'HEART_RATE') return 0; // bpm é inteiro: 89 e 99 são valores distintos.
  if (tipo === 'WAIST_HIP_RATIO') return 0.005;
  if (tipo.endsWith('_PERCENT')) return 0.03;
  return 0.05;
}

/** Dois campos medem a mesma coisa com o mesmo valor? */
export function equivalentes(a: CampoExtraido, b: CampoExtraido): boolean {
  if (a.type !== b.type) return false;

  // INV-104: ausência não é zero, e ausência não equivale a nada — nem a
  // outra ausência: dois arquivos que não leram o campo não confirmam um
  // ao outro.
  if (a.extractedValue === null || b.extractedValue === null) return false;

  try {
    const canonicaA = converterParaCanonica({
      type: a.type, value: a.extractedValue, unit: a.extractedUnit,
    });
    const canonicaB = converterParaCanonica({
      type: b.type, value: b.extractedValue, unit: b.extractedUnit,
    });

    return Math.abs(canonicaA.canonicalValue - canonicaB.canonicalValue) <= toleranciaDe(a.type);
  } catch (erro) {
    // Bug de programação (ex.: TypeError) não é divergência -- tem que
    // estourar, não virar um "false" plausível que esconde o bug num
    // resultado de revisão normal.
    if (!(erro instanceof ErroDeDominio)) throw erro;

    // Valor fora da faixa plausível ou unidade incompatível NÃO é "não sei" —
    // é exatamente a divergência que o humano precisa ver. Nunca propagar o
    // throw: um campo implausível derrubaria a tela de revisão inteira.
    return false;
  }
}

export interface LinhaConsolidada {
  readonly type: TipoDeMedida;
  /** Um campo quando concordam; todos quando divergem. */
  readonly campos: readonly CampoExtraido[];
  readonly concordante: boolean;
  readonly origens: readonly string[];
}

/**
 * Agrupa por tipo e decide, por grupo, se é uma linha ou várias.
 *
 * Ordem de entrada preservada: a origem que aparece primeiro é a primeira
 * listada, e a revisão fica estável entre recarregamentos.
 */
export function consolidar(campos: readonly CampoExtraido[]): LinhaConsolidada[] {
  const porTipo = new Map<TipoDeMedida, CampoExtraido[]>();

  for (const campo of campos) {
    const grupo = porTipo.get(campo.type);
    if (grupo === undefined) porTipo.set(campo.type, [campo]);
    else grupo.push(campo);
  }

  const linhas: LinhaConsolidada[] = [];

  for (const [type, grupo] of porTipo) {
    // grupo nunca e vazio: cada entrada do Map nasce com [campo] (linha 80).
    const primeiro = grupo[0]!;
    const todosConcordam = grupo.every((campo) => equivalentes(primeiro, campo));
    const origens = grupo
      .map((campo) => campo.sourceLabel)
      .filter((label): label is string => label !== null);

    linhas.push({
      type,
      campos: todosConcordam ? [primeiro] : grupo,
      concordante: todosConcordam && grupo.length > 1,
      origens,
    });
  }

  return linhas;
}
