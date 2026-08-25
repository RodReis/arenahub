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
export { ConsentCard } from './components/ConsentCard.js';
export { DataFreshness } from './components/DataFreshness.js';
export { BarrasDeFaixa, type FaixaDeBarra } from './components/BarrasDeFaixa.js';
export { SerieFinanceira, type PontoFinanceiro } from './components/SerieFinanceira.js';
export { Sparkline } from './components/Sparkline.js';
export { formatarDinheiro, percentualDoTotal } from './dinheiro.js';
export { SerieDeMedidas, type PontoDaSerie } from './components/SerieDeMedidas.js';
export { DataTable, type Column, type ColumnRole } from './components/DataTable.js';
export { Identidade, iniciaisDe } from './components/Identidade.js';
export { Telefone, formatarTelefone } from './components/Telefone.js';
export {
  AcoesDaLinha,
  AusenteDeAcao,
  Consequencia,
  EstadoSimples,
  Idade,
} from './components/CelulasDeTabela.js';
export { ElevatedSessionBanner } from './components/ElevatedSessionBanner.js';
export { EmptyState } from './components/EmptyState.js';
export { Field } from './components/Field.js';
export { Icon, type IconName } from './components/Icon.js';
export { PasswordField } from './components/PasswordField.js';
export { Cpf } from './components/Cpf.js';
export { Money } from './components/Money.js';
export { ProblemDetail, type ProblemJson } from './components/ProblemDetail.js';
export { SelectField } from './components/SelectField.js';
export { SensitiveAction } from './components/SensitiveAction.js';
export { StateBadge } from './components/StateBadge.js';
export { TextareaField } from './components/TextareaField.js';
export { ToastProvider, useToast, type ToastKind } from './components/Toast.js';
export { useToastDeErro } from './components/useToastDeErro.js';

export { AppShell } from './components/shell/AppShell.js';
export { NavLink } from './components/shell/NavLink.js';
export { PageHeader } from './components/shell/PageHeader.js';

/**
 * Contratos sem tela -- SPEC-042 §3. Props e token de componente cujo MVP dono
 * ainda nao chegou; a implementacao vem com a fatia que tiver o que renderizar.
 */
export {
  AI_DISCLAIMER_CODE,
  RISK_BANDS,
  type AIDisclaimerProps,
  type AsyncJobStatusProps,
  type ChartWithTableProps,
  type FieldReviewProps,
  type RiskBandProps,
} from './contracts/future-components.js';
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
