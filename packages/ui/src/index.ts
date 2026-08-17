/**
 * `@arenahub/ui` -- design system do ArenaHub.
 *
 * O pipeline de tokens veio do card `[INFRA]` do ADR-025 decisao 1: mecanica
 * de build sem decisao de produto.
 *
 * Os COMPONENTES sao a fatia **F42 / SPEC-042**, que consome esse pipeline.
 * `Icon` e `Ausente` abriram a fila por serem os unicos sem rotulo de dominio;
 * `state-labels.ts` chega em seguida por ser pre-requisito do `StateBadge`.
 * `ProblemDetail`, `DataFreshness` e `Toast` vem nas tarefas seguintes. A
 * separacao e o proprio ADR-025: rotulo pt-BR de enum de dominio e decisao de
 * produto e passa pelo aceite do PI; JSON virando CSS nao decide nada.
 */

export { Ausente } from './components/Ausente.js';
export { Button } from './components/Button.js';
export { DataFreshness } from './components/DataFreshness.js';
export { EmptyState } from './components/EmptyState.js';
export { Icon, type IconName } from './components/Icon.js';
export { MaskedCPF } from './components/MaskedCPF.js';
export { Money } from './components/Money.js';
export { ProblemDetail, type ProblemJson } from './components/ProblemDetail.js';
export { StateBadge } from './components/StateBadge.js';
export { ToastProvider, useToast, type ToastKind } from './components/Toast.js';
export { TenantDateTime } from './components/TenantDateTime.js';

export {
  STATE_LABELS,
  stateLabel,
  type StateLabel,
  type StateMachine,
  type Tone,
} from './domain/state-labels.js';

export {
  AA_LARGE,
  AA_TEXT,
  contrastRatio,
  meets,
  parseHex,
  ratio,
  relativeLuminance,
  type Rgb,
} from './contrast.js';

export {
  accentCssVars,
  deriveRamp,
  resolveAccent,
  RAMP_TONES,
  type AccentRamp,
  type RampTone,
  type ResolvedAccent,
} from './accent.js';

export {
  ACCENT_SEED_DEFAULT,
  BREAKPOINT,
  CARBON,
  CONTRAST_REPORT,
  SEMANTIC_COLOR,
  TYPE_SCALE,
} from './tokens.generated.js';
