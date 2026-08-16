/**
 * `@arenahub/ui` -- design system do ArenaHub.
 *
 * O pipeline de tokens veio do card `[INFRA]` do ADR-025 decisao 1: mecanica
 * de build sem decisao de produto.
 *
 * Os COMPONENTES sao a fatia **F42 / SPEC-042**, que consome esse pipeline.
 * `Icon` e `Ausente` abrem a fila por serem os unicos sem rotulo de dominio:
 * `StateBadge`, `ProblemDetail`, `DataFreshness`, `Toast` e `state-labels.ts`
 * chegam nas tarefas seguintes. A separacao e o proprio ADR-025: rotulo pt-BR
 * de enum de dominio e decisao de produto e passa pelo aceite do PI; JSON
 * virando CSS nao decide nada.
 */

export { Ausente } from './components/Ausente.js';
export { Icon, type IconName } from './components/Icon.js';

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
