/* GERADO POR scripts/build-tokens.mjs -- NAO EDITE A MAO. */
/* Fonte: packages/ui/tokens/*.json  ·  Contrato: docs/design/DS-PAINEL.md */

export const CARBON = {
  "50": "#F5F7F9",
  "100": "#E5E9EE",
  "200": "#CBD1D9",
  "300": "#A6AEB9",
  "400": "#7B8491",
  "500": "#565E69",
  "600": "#3C424B",
  "700": "#2B3037",
  "800": "#1F2328",
  "900": "#121417"
} as const;

export const SEMANTIC_COLOR = {
  "success": "#157F3D",
  "warning": "#8A5200",
  "danger": "#C22B2B",
  "info": "#1F5FD0",
  "risk": "#B4470B"
} as const;

export const ACCENT_SEED_DEFAULT = "#00A9B8";

export const TYPE_SCALE = {
  "display": {
    "size": 28,
    "lineHeight": 34,
    "weight": 700
  },
  "title": {
    "size": 20,
    "lineHeight": 26,
    "weight": 600
  },
  "heading": {
    "size": 16,
    "lineHeight": 22,
    "weight": 600
  },
  "body": {
    "size": 14,
    "lineHeight": 20,
    "weight": 400
  },
  "body-strong": {
    "size": 14,
    "lineHeight": 20,
    "weight": 600
  },
  "caption": {
    "size": 12,
    "lineHeight": 16,
    "weight": 400
  },
  "mono": {
    "size": 12,
    "lineHeight": 16,
    "weight": 400
  }
} as const;

export const BREAKPOINT = {
  "degraded": 1024,
  "operational": 1280
} as const;

/** Contraste efetivo de cada papel, medido no build. */
export const CONTRAST_REPORT = [
  {
    "role": "text.strong",
    "fg": "#1F2328",
    "bg": "surface.raised",
    "value": 15.8,
    "exempt": null
  },
  {
    "role": "text.default",
    "fg": "#2B3037",
    "bg": "surface.raised",
    "value": 13.29,
    "exempt": null
  },
  {
    "role": "text.label",
    "fg": "#3C424B",
    "bg": "surface.raised",
    "value": 10.13,
    "exempt": null
  },
  {
    "role": "text.secondary",
    "fg": "#565E69",
    "bg": "surface.raised",
    "value": 6.56,
    "exempt": null
  },
  {
    "role": "text.onChrome",
    "fg": "#A6AEB9",
    "bg": "surface.chrome",
    "value": 8.24,
    "exempt": null
  },
  {
    "role": "text.placeholder",
    "fg": "#7B8491",
    "bg": "surface.raised",
    "value": 3.78,
    "exempt": "placeholder"
  },
  {
    "role": "text.icon",
    "fg": "#7B8491",
    "bg": "surface.raised",
    "value": 3.78,
    "exempt": "decorative"
  },
  {
    "role": "state.success",
    "fg": "#157F3D",
    "bg": "white",
    "value": 5.08,
    "exempt": null
  },
  {
    "role": "state.warning",
    "fg": "#8A5200",
    "bg": "white",
    "value": 6.39,
    "exempt": null
  },
  {
    "role": "state.danger",
    "fg": "#C22B2B",
    "bg": "white",
    "value": 5.72,
    "exempt": null
  },
  {
    "role": "state.info",
    "fg": "#1F5FD0",
    "bg": "white",
    "value": 5.82,
    "exempt": null
  },
  {
    "role": "state.risk",
    "fg": "#B4470B",
    "bg": "white",
    "value": 5.46,
    "exempt": null
  },
  {
    "role": "state.neutral",
    "fg": "#565E69",
    "bg": "white",
    "value": 6.56,
    "exempt": null
  }
] as const;
