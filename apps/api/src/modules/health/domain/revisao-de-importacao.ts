import type { TipoDeMedida, UnidadeDeMedida } from './medida.js';

/**
 * Revisao campo a campo de um arquivo importado (F19, Slice 3.3).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * ---------------------------------------------------------------------------
 * A REGRA No 8 APLICADA AO OCR: NADA VIRA HISTORICO SEM UM HUMANO OLHAR.
 * ---------------------------------------------------------------------------
 *
 * `M3-BR-006` e INV-103: "OCR/IA nunca publica automaticamente". Isso NAO
 * significa "mostrar uma tela de confirmacao" -- significa que o valor
 * extraido nao existe como medida ate alguem decidir sobre ele, campo a
 * campo. Por isso o estado de revisao mora em CADA CAMPO e nao na importacao:
 *
 *   - confirmar um valor certo e barato;
 *   - corrigir um valor errado precisa preservar o que o OCR leu, ou a
 *     proveniencia se perde (`M3-FR-010`, aceite da Slice 3.3);
 *   - descartar um campo que o aparelho nem mediu tem de ser possivel sem
 *     inventar zero (INV-104).
 *
 * Um estado unico por importacao ("revisada / nao revisada") forcaria o
 * avaliador a aceitar tudo ou rejeitar tudo -- e o caso comum e justamente o
 * meio: nove campos certos e um que o OCR leu como 3,15 quando era 31,5.
 *
 * ---------------------------------------------------------------------------
 * A CONFIANCA DO OCR NAO DECIDE NADA. ELA ORDENA A FILA.
 * ---------------------------------------------------------------------------
 *
 * `M3-FR-010` manda registrar a confianca. Ela serve para o avaliador olhar
 * primeiro o que provavelmente esta errado -- e NAO para auto-confirmar campo
 * de alta confianca, que seria a regra no 8 contornada por um limiar.
 */

/** O que o avaliador decidiu sobre um campo extraido. */
export type EstadoDoCampo =
  /** Ainda nao revisado. Nao vira medida. */
  | 'PENDING'
  /** O valor do OCR esta certo. */
  | 'CONFIRMED'
  /** O avaliador digitou outro valor; o do OCR fica guardado. */
  | 'CORRECTED'
  /** Nao e medida valida -- ruido do OCR, campo que o aparelho nao mediu. */
  | 'DISCARDED';

/** Um campo lido do arquivo, com o que o extrator conseguiu dizer dele. */
export interface CampoExtraido {
  readonly id: string;
  readonly type: TipoDeMedida;
  /** O que o OCR leu. NUNCA e sobrescrito -- e a proveniencia. */
  readonly extractedValue: number | null;
  readonly extractedUnit: UnidadeDeMedida | null;
  /**
   * 0..1 quando o extrator informa. `null` quando ele nao sabe medir
   * confianca -- parser de CSV, por exemplo, que ou le ou falha.
   *
   * `null` NAO e zero: zero significaria "o extrator acha que errou", e
   * ordenaria a fila como se fosse o campo mais suspeito do laudo.
   */
  readonly confidence: number | null;
  /** Onde no documento (pagina, linha), quando o extrator informa. */
  readonly sourceLocation: string | null;
  readonly state: EstadoDoCampo;
  /** Preenchido quando `CORRECTED`. */
  readonly reviewedValue: number | null;
  readonly reviewedUnit: UnidadeDeMedida | null;
  /**
   * Nome do arquivo/aparelho de origem (ex.: "CF610_G", "ECG 30s").
   *
   * `null` quando a origem nao e rastreada. Usado so para exibicao -- a
   * consolidacao de multiplos laudos (F-multiarquivo) mostra de onde cada
   * valor veio, nunca para decidir equivalencia.
   */
  readonly sourceLabel: string | null;
}

export type MotivoDeBloqueio =
  /** Ha campo que ninguem revisou (`M3-AC-005`). */
  | 'IMPORT_HAS_PENDING_FIELDS'
  /** Todos os campos foram descartados -- nao ha o que publicar. */
  | 'IMPORT_HAS_NO_USABLE_FIELD'
  /** Campo corrigido sem valor novo. */
  | 'IMPORT_CORRECTION_WITHOUT_VALUE';

export type AvaliacaoDaRevisao =
  | { readonly pronta: true }
  | { readonly pronta: false; readonly motivo: MotivoDeBloqueio; readonly campoId: string | null };

/**
 * A importacao pode virar avaliacao?
 *
 * Esta funcao e o INV-103 em codigo. Se ela devolvesse `true` com campo
 * pendente, o OCR estaria publicando sozinho -- que e exatamente o que a
 * regra de arquitetura no 8 proibe.
 */
export function revisaoCompleta(campos: readonly CampoExtraido[]): AvaliacaoDaRevisao {
  const pendente = campos.find((campo) => campo.state === 'PENDING');

  if (pendente) {
    return {
      pronta: false,
      motivo: 'IMPORT_HAS_PENDING_FIELDS',
      campoId: pendente.id,
    };
  }

  const corrigidoSemValor = campos.find(
    (campo) => campo.state === 'CORRECTED' && campo.reviewedValue === null,
  );

  if (corrigidoSemValor) {
    return {
      pronta: false,
      motivo: 'IMPORT_CORRECTION_WITHOUT_VALUE',
      campoId: corrigidoSemValor.id,
    };
  }

  // Importacao inteira descartada NAO vira avaliacao vazia: uma avaliacao sem
  // medida nenhuma seria um ponto no grafico que nao mediu nada (INV-104).
  const aproveitavel = campos.some(
    (campo) => campo.state === 'CONFIRMED' || campo.state === 'CORRECTED',
  );

  if (!aproveitavel) {
    return { pronta: false, motivo: 'IMPORT_HAS_NO_USABLE_FIELD', campoId: null };
  }

  return { pronta: true };
}

/** O valor que vale para um campo revisado -- o do OCR ou o corrigido. */
export interface ValorAceito {
  readonly type: TipoDeMedida;
  readonly value: number;
  readonly unit: UnidadeDeMedida | null;
}

/**
 * Os valores que viram medida, ja resolvidos entre extraido e corrigido.
 *
 * Campo `DISCARDED` simplesmente NAO ENTRA -- nao vira zero, nao vira `null`
 * numa lista de medidas. Ausencia e ausencia (INV-104): o dia em que o
 * aparelho nao mediu gordura nao e o dia em que a gordura foi zero.
 */
export function valoresAceitos(campos: readonly CampoExtraido[]): ValorAceito[] {
  const aceitos: ValorAceito[] = [];

  for (const campo of campos) {
    if (campo.state === 'CONFIRMED') {
      // Confirmado sem valor extraido e incoerente -- o avaliador confirmou o
      // que? Descartar em silencio esconderia um bug do extrator; por isso a
      // guarda existe aqui e nao numa validacao distante.
      if (campo.extractedValue === null) continue;

      aceitos.push({
        type: campo.type,
        value: campo.extractedValue,
        unit: campo.extractedUnit,
      });

      continue;
    }

    if (campo.state === 'CORRECTED' && campo.reviewedValue !== null) {
      aceitos.push({
        type: campo.type,
        value: campo.reviewedValue,
        // Corrigir o valor sem informar unidade mantem a que o OCR leu: o
        // avaliador que digita "31,5" no campo de agua intracelular esta
        // corrigindo o NUMERO, nao a grandeza.
        unit: campo.reviewedUnit ?? campo.extractedUnit,
      });
    }
  }

  return aceitos;
}

/**
 * Ordem em que os campos vao para a tela.
 *
 * Menor confianca primeiro, porque e onde o avaliador precisa olhar. Campo
 * sem confianca declarada (`null`) vai para o FIM e nao para o inicio: parser
 * de CSV nao erra silenciosamente -- ou le, ou falha --, e trata-lo como
 * suspeito enterraria os campos de OCR que realmente pedem atencao.
 *
 * Desempate por `type` para a ordem ser deterministica: sem ele, dois campos
 * de mesma confianca sairiam na ordem do banco, e a tela mudaria de ordem
 * entre recarregamentos sem nada ter mudado.
 */
export function ordemDeRevisao(campos: readonly CampoExtraido[]): CampoExtraido[] {
  return [...campos].sort((a, b) => {
    const ca = a.confidence ?? Number.POSITIVE_INFINITY;
    const cb = b.confidence ?? Number.POSITIVE_INFINITY;

    return ca - cb || a.type.localeCompare(b.type);
  });
}

/** Quantos campos faltam revisar -- o numero que o painel da F22 mostra. */
export function pendentes(campos: readonly CampoExtraido[]): number {
  return campos.filter((campo) => campo.state === 'PENDING').length;
}
