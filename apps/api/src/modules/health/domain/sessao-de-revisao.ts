import type { LinhaConsolidada } from './consolidacao-de-laudos.js';

/**
 * Regras de composição de uma sessão de revisão (spec §3.2 e §3.4).
 *
 * Funções puras. Decisão do PI: bioimpedância é obrigatória, ECG é opcional.
 * O ECG sozinho não vira avaliação porque não há composição corporal a
 * comparar — e uma avaliação sem medida corporal seria um ponto vazio na
 * série da F18.
 */

/**
 * Que laudo e o arquivo.
 *
 * `BIOIMPEDANCE` e a BALANCA -- o aparelho que mediu o corpo.
 * `BIOIMPEDANCE_ANALYSIS` e o app que le a medicao da balanca e DERIVA
 * numeros a partir dela. Os dois trazem os mesmos tipos de medida, e por
 * isso precisam ser distinguiveis: o ADR-041 manda o medido vencer o
 * derivado, e sem essa separacao a regra nao tem em que se apoiar.
 *
 * A distincao vem DECLARADA no envio (cada laudo tem seu campo na tela),
 * nunca da classificacao por imagem -- o OCR devolve `BIOIMPEDANCE` para
 * toda foto.
 */
export type TipoDeLaudo = 'BIOIMPEDANCE' | 'BIOIMPEDANCE_ANALYSIS' | 'ECG' | 'UNKNOWN';

export interface ArquivoDaSessao {
  readonly importId: string;
  readonly sourceLabel: string;
  readonly tipoDeLaudo: TipoDeLaudo;
  /** Status do import (`EXTRACTED`, `FAILED`, `CONFIRMED`…). Opcional em dublê puro. */
  readonly status?: string;
  /** Por que falhou, quando falhou. */
  readonly failureReason?: string | null;
  /**
   * `extracted_attributes` cru do ARQUIVO, OPACO (ADR-035): nenhuma funcao
   * deste dominio le o conteudo para decidir nada -- so viaja ate a tela de
   * revisao citar o texto (ex.: `ecgFinding`). Ausente ou `null` quando o
   * arquivo nao trouxe atributo nenhum, ou quando quem monta o objeto (como
   * os testes puros deste arquivo) nao precisa dele.
   */
  readonly atributos?: Record<string, unknown> | null;
}

export type MotivoDeBloqueioDaSessao =
  /** Nenhum arquivo na sessão. */
  | 'SESSION_EMPTY'
  /** Só ECG, ou nenhum laudo de bioimpedância reconhecido. */
  | 'BIOIMPEDANCE_REQUIRED'
  /** Dois arquivos discordam num campo e ninguém escolheu ainda. */
  | 'DIVERGENCE_UNRESOLVED';

export type AvaliacaoDaSessao =
  | { readonly pronta: true }
  | { readonly pronta: false; readonly motivo: MotivoDeBloqueioDaSessao };

export function sessaoPodeConfirmar(
  arquivos: readonly ArquivoDaSessao[],
  linhas: readonly LinhaConsolidada[],
): AvaliacaoDaSessao {
  if (arquivos.length === 0) return { pronta: false, motivo: 'SESSION_EMPTY' };

  // A BALANCA e obrigatoria; o app de analise NAO a substitui.
  //
  // `BIOIMPEDANCE_ANALYSIS` deriva numeros da medicao da balanca -- sozinho,
  // ele nao tem medicao propria para virar avaliacao. Aceita-lo aqui
  // publicaria uma avaliacao inteira feita de valores calculados sobre um
  // laudo que ninguem anexou.
  const temBalanca = arquivos.some((arquivo) => arquivo.tipoDeLaudo === 'BIOIMPEDANCE');
  if (!temBalanca) return { pronta: false, motivo: 'BIOIMPEDANCE_REQUIRED' };

  // Divergência exige escolha EXPLÍCITA: enquanto qualquer lado estiver
  // pendente, ninguém decidiu qual valor é o verdadeiro. Não há default —
  // escolher por ele seria decidir no lugar de quem avalia.
  const divergenciaAberta = linhas.some(
    (linha) => !linha.concordante
      && linha.campos.length > 1
      && linha.campos.some((campo) => campo.state === 'PENDING'),
  );

  if (divergenciaAberta) return { pronta: false, motivo: 'DIVERGENCE_UNRESOLVED' };

  return { pronta: true };
}
