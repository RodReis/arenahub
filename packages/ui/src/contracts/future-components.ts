import type { Tone } from '../domain/state-labels.js';

/**
 * Contrato dos componentes cuja TELA pertence a um MVP futuro -- SPEC-042 §3.
 *
 * Props e token entram agora; a implementacao entra com a fatia que tem tela
 * para consumi-la. Escrever o componente sem consumidor produziria codigo
 * morto que envelhece antes do primeiro uso -- e o contrato e o que impede a
 * fatia futura de reinventar o formato.
 *
 * `FieldReview` aparece no §8.4 como padrao critico E no §3 como escopo
 * negativo. O §3 vence: e mais especifico e nomeia o MVP dono (3).
 */

/**
 * MVP 3 -- regra de arquitetura 8: IA e OCR nunca publicam dado de saude
 * sozinhos. Toda saida de IA carrega este codigo, e e rejeitada se trouxer
 * diagnostico ou valor inexistente.
 */
export const AI_DISCLAIMER_CODE = 'NOT_MEDICAL_DIAGNOSIS';

export interface AIDisclaimerProps {
  readonly disclaimerCode: typeof AI_DISCLAIMER_CODE;
  readonly modelVersion: string;
  readonly promptVersion: string;
  /**
   * Persistente, NAO dispensavel -- DS-PAINEL.md §8.4.
   *
   * Literal `false` em vez de `boolean`: quem tentar passar `true` nao
   * compila. Um aviso de saude que o operador fecha e um aviso que nao existe
   * a partir do segundo uso.
   */
  readonly dismissible: false;
}

/**
 * MVP 3 -- nada grava antes da confirmacao campo a campo (§8.4).
 *
 * `referenceRange` e nulo quando nao ha faixa publicada; ausencia renderiza
 * `—`, nunca zero.
 */
export interface FieldReviewProps {
  readonly field: string;
  readonly extracted: string;
  readonly referenceRange: string | null;
  /** Qual arquivo originou o valor -- rastreabilidade da extracao. */
  readonly source: string;
  readonly confidence: number;
  readonly onConfirm: (value: string) => void;
}

/**
 * MVP 6 -- faixa com intervalo PUBLICADO, nunca percentual de falsa precisao.
 *
 * "Risco 73,4%" afirma sobre uma pessoa uma precisao que o modelo nao tem.
 * A faixa com intervalo diz o mesmo sem fingir exatidao (`M6-BR-001`: e
 * recomendacao operacional, nao fato sobre o aluno).
 */
export const RISK_BANDS = [
  { band: 'LOW', range: '0–24', tone: 'success' },
  { band: 'MEDIUM', range: '25–49', tone: 'warning' },
  { band: 'HIGH', range: '50–74', tone: 'risk' },
  { band: 'CRITICAL', range: '75–100', tone: 'danger' },
] as const satisfies readonly { band: string; range: string; tone: Tone }[];

export interface RiskBandProps {
  readonly band: (typeof RISK_BANDS)[number]['band'];
  /** Versao da regra que produziu a faixa -- score sem versao nao se audita. */
  readonly ruleVersion: string;
}

/**
 * MVP 3 -- todo grafico tem tabela equivalente REAL no DOM (§10 item 2).
 *
 * Nao e `aria-label` no canvas: e `<table>` de verdade, porque quem usa leitor
 * de tela precisa dos numeros, nao da descricao do desenho.
 */
export interface ChartWithTableProps<T> {
  readonly rows: readonly T[];
  readonly caption: string;
  readonly tableOnly?: boolean;
}

/** MVP 2 -- progresso de tarefa longa. `progress` nulo = indeterminado. */
export interface AsyncJobStatusProps {
  readonly state: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';
  readonly progress: number | null;
}
