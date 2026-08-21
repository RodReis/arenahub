import type { LinhaConsolidada } from './consolidacao-de-laudos.js';

/**
 * Regras de composição de uma sessão de revisão (spec §3.2 e §3.4).
 *
 * Funções puras. Decisão do PI: bioimpedância é obrigatória, ECG é opcional.
 * O ECG sozinho não vira avaliação porque não há composição corporal a
 * comparar — e uma avaliação sem medida corporal seria um ponto vazio na
 * série da F18.
 */

export type TipoDeLaudo = 'BIOIMPEDANCE' | 'ECG' | 'UNKNOWN';

export interface ArquivoDaSessao {
  readonly importId: string;
  readonly sourceLabel: string;
  readonly tipoDeLaudo: TipoDeLaudo;
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

  const temBio = arquivos.some((arquivo) => arquivo.tipoDeLaudo === 'BIOIMPEDANCE');
  if (!temBio) return { pronta: false, motivo: 'BIOIMPEDANCE_REQUIRED' };

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
