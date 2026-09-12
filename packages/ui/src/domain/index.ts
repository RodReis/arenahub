/**
 * A parte do design system que NAO depende de React -- entrypoint
 * `@arenahub/ui/domain`.
 *
 * Existe para o app do aluno (`apps/mobile`, F43) poder usar o dicionario de
 * estado e os contratos de componente sem importar de `.`, que exporta
 * componente web e arrastaria `react-dom` e `recharts` para o bundle do
 * celular.
 *
 * Nao ha codigo novo aqui, e nao deve haver: este arquivo so reexporta. Se
 * algum dia precisar de logica propria, ela esta no modulo errado.
 */

export {
  STATE_LABELS,
  stateLabel,
  type StateLabel,
  type StateMachine,
  type Tone,
} from './state-labels.js';

export {
  AI_DISCLAIMER_CODE,
  RISK_BANDS,
  type AIDisclaimerProps,
  type AsyncJobStatusProps,
  type ChartWithTableProps,
  type FieldReviewProps,
  type RiskBandProps,
} from '../contracts/future-components.js';
