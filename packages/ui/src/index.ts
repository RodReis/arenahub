/**
 * `@arenahub/ui` -- design system do ArenaHub.
 *
 * Esta entrega e o card `[INFRA]` do ADR-025 decisao 1: **pipeline de tokens
 * e esqueleto**, mecanica de build sem decisao de produto.
 *
 * Os COMPONENTES nao moram aqui ainda -- `StateBadge`, `ProblemDetail`,
 * `DataFreshness`, `Toast`, `state-labels.ts` e o resto do inventario de 17
 * (DS-PAINEL.md §9) sao a fatia **F42 / SPEC-042**, que consome este pipeline.
 * A separacao e o proprio ADR-025: rotulo pt-BR de enum de dominio e decisao
 * de produto e passa pelo aceite do PI; JSON virando CSS nao decide nada.
 */

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
