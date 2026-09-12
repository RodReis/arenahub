/* GERADO POR scripts/build-tokens.mjs -- NAO EDITE A MAO. */
/* Fonte: packages/ui/tokens/app.json  ·  Contrato: docs/design/DS-APP.md */

/**
 * Tokens da superficie `apps/mobile` (app do aluno).
 *
 * React Native nao tem custom property: este objeto E a camada de tokens do
 * app, e nao um espelho de um CSS que existe noutro lugar. Componente le
 * daqui e de nenhum outro lugar -- hex literal em `apps/mobile` e erro de
 * lint (regra 1 do DS-APP.md §2).
 *
 * DARK e o padrao (DS-APP.md §1). LIGHT segue o SO a partir do MVP 4 e reusa
 * a paleta do painel, ja validada -- ver o `$comment` de `light` no JSON.
 */
export const APP_TOKENS = {
  dark: {
    "bg": {
      "app": "#0A0B0D",
      "surface": "#121417",
      "raised": "#1A2032"
    },
    "border": {
      "default": "#5F71A0",
      "hairline": "#232A3D"
    },
    "text": {
      "primary": "#F5F7F9",
      "secondary": "#A6AEB9",
      "muted": "#7B8491",
      "placeholder": "#565E69",
      "onImage": "#FFFFFF",
      "onImageMuted": "#E5E9EE"
    },
    "accent": {
      "solid": "#4D7CFF",
      "gradientFrom": "#5B86FF",
      "gradientTo": "#3E63E8",
      "gradientHoverFrom": "#6B92FF",
      "gradientHoverTo": "#4A6FF0",
      "ink": "#7DA2FF",
      "text": "#8FB0FF",
      "soft": "#C9D9FF",
      "tint": "rgba(77,124,255,.12)",
      "onAccent": "#FFFFFF"
    },
    "brand": {
      "frame": "#0D1226",
      "markFrom": "#7DA2FF",
      "markMid": "#2E4FD0",
      "markTo": "#9DB8FF"
    },
    "state": {
      "ok": "#3DDC84",
      "warn": "#F5A524",
      "err": "#FF6B6B",
      "info": "#6AB0FF"
    },
    "scrim": {
      "default": "rgba(10,11,13,.7)"
    },
    "optico": {
      "qrBackground": "#FFFFFF",
      "qrInk": "#1F2328"
    }
  },
  light: {
    "bg": {
      "app": "#EDF0F5",
      "surface": "#FFFFFF",
      "raised": "#E4EAF6"
    },
    "border": {
      "default": "#7B8491",
      "hairline": "#E5E9EE"
    },
    "text": {
      "primary": "#1F2328",
      "secondary": "#565E69",
      "muted": "#7B8491",
      "placeholder": "#9AA3AE",
      "onImage": "#FFFFFF",
      "onImageMuted": "#E5E9EE"
    },
    "accent": {
      "solid": "#4D7CFF",
      "gradientFrom": "#5B86FF",
      "gradientTo": "#3E63E8",
      "gradientHoverFrom": "#6B92FF",
      "gradientHoverTo": "#4A6FF0",
      "ink": "#3E63E8",
      "text": "#2E4FD0",
      "soft": "#1B3AAE",
      "tint": "rgba(77,124,255,.12)",
      "onAccent": "#FFFFFF"
    },
    "brand": {
      "frame": "#0D1226",
      "markFrom": "#7DA2FF",
      "markMid": "#2E4FD0",
      "markTo": "#9DB8FF"
    },
    "state": {
      "ok": "#157F3D",
      "warn": "#8A5200",
      "err": "#C22B2B",
      "info": "#1F5FD0"
    },
    "scrim": {
      "default": "rgba(31,35,40,.45)"
    },
    "optico": {
      "qrBackground": "#FFFFFF",
      "qrInk": "#1F2328"
    }
  },
} as const;

/** Tamanhos em px do DS-APP.md §2.6 e §2.8. Alvo tocavel minimo: 44. */
export const APP_SIZE = {
  "safeAreaTop": 58,
  "gutter": 20,
  "control": 48,
  "controlInCard": 44,
  "tile": 64,
  "segment": 40,
  "chip": 30,
  "badge": 26,
  "row": 56,
  "rowTable": 44,
  "tabBar": 56,
  "avatar": 44,
  "mark": 52,
  "render3d": 200,
  "touchMin": 44
} as const;

/** Raios do DS-APP.md §2.7. Sem sombra: a hierarquia vem das superficies. */
export const APP_RADIUS = {
  "sheet": 20,
  "card": 16,
  "mark": 15,
  "control": 12,
  "segment": 9,
  "progress": 4,
  "bar": 3,
  "pill": 999
} as const;

/** Escala de espacamento de 2px -- DS-APP.md §2.6. */
export const APP_SPACE = [2,4,5,6,8,10,12,14,16,18,20,24,32] as const;

/** Papeis tipograficos do DS-APP.md §2.5. */
export const APP_TYPE = {
  "loginTitle": {
    "size": 26,
    "lineHeight": 32,
    "weight": 700
  },
  "screenTitle": {
    "size": 24,
    "lineHeight": 30,
    "weight": 700
  },
  "value": {
    "size": 30,
    "lineHeight": 36,
    "weight": 700
  },
  "sheetTitle": {
    "size": 18,
    "lineHeight": 24,
    "weight": 700
  },
  "cardTitle": {
    "size": 16,
    "lineHeight": 22,
    "weight": 600
  },
  "buttonPrimary": {
    "size": 16,
    "lineHeight": 20,
    "weight": 700
  },
  "buttonSecondary": {
    "size": 15,
    "lineHeight": 20,
    "weight": 600
  },
  "body": {
    "size": 14,
    "lineHeight": 20,
    "weight": 400
  },
  "fieldLabel": {
    "size": 13,
    "lineHeight": 18,
    "weight": 600
  },
  "tileLabel": {
    "size": 13,
    "lineHeight": 18,
    "weight": 600
  },
  "overline": {
    "size": 12,
    "lineHeight": 16,
    "weight": 700
  },
  "meta": {
    "size": 12,
    "lineHeight": 16,
    "weight": 400
  },
  "tabLabel": {
    "size": 11,
    "lineHeight": 14,
    "weight": 600
  }
} as const;

export const APP_FONT = {
  "sans": "Inter",
  "mono": "JetBrainsMono"
} as const;

/** Duracoes em ms -- DS-APP.md §7: pulse e spin sao os unicos movimentos. */
export const APP_MOTION = {
  "pulse": 1400,
  "spin": 1400
} as const;

/**
 * Opacidade do fundo e da borda do badge de estado, POR TEMA.
 *
 * Dark usa 16% (§2.4: "mais opaca que no painel, porque o fundo aqui e
 * escuro"); light usa os 10% do painel. A diferenca nao e cosmetica: a 16%
 * sobre branco o `err` entrega 4.43 e REPROVA o alvo de 4.5. O build mede
 * o texto sobre o tint que estes numeros produzem -- mudar um deles aqui
 * sem rodar o gate e como o badge do painel passou anos medindo o par errado.
 */
export const APP_STATE_TINT = {
  "dark": {
    "bg": 0.16,
    "border": 0.34
  },
  "light": {
    "bg": 0.1,
    "border": 0.3
  }
} as const;

export type AppTheme = keyof typeof APP_TOKENS;
export type AppTokens = (typeof APP_TOKENS)[AppTheme];
