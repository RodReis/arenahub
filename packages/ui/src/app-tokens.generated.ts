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
      "app": "#121417",
      "surface": "#181B1F",
      "raised": "#1F2328"
    },
    "border": {
      "default": "#646D79"
    },
    "text": {
      "primary": "#F5F7F9",
      "secondary": "#A6AEB9",
      "muted": "#7B8491"
    },
    "accent": {
      "solid": "#1FBED0",
      "hover": "#4FD5E3",
      "soft": "#C2F2F7",
      "tint": "rgba(31,190,208,.10)",
      "onAccent": "#0A0B0D"
    },
    "state": {
      "ok": "#3DDC84",
      "warn": "#F5A524",
      "err": "#FF6B6B",
      "info": "#6AB0FF"
    },
    "scrim": {
      "default": "rgba(10,11,13,.7)"
    }
  },
  light: {
    "bg": {
      "app": "#F5F7F9",
      "surface": "#FFFFFF",
      "raised": "#E5E9EE"
    },
    "border": {
      "default": "#7B8491"
    },
    "text": {
      "primary": "#1F2328",
      "secondary": "#565E69",
      "muted": "#7B8491"
    },
    "accent": {
      "solid": "#00707B",
      "hover": "#005760",
      "soft": "#E8FBFD",
      "tint": "rgba(0,112,123,.10)",
      "onAccent": "#FFFFFF"
    },
    "state": {
      "ok": "#13763A",
      "warn": "#8A5200",
      "err": "#C22B2B",
      "info": "#1F5FD0"
    },
    "scrim": {
      "default": "rgba(18,20,23,.5)"
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
  "segment": 36,
  "chip": 32,
  "badge": 26,
  "row": 44,
  "tabBar": 56,
  "avatar": 44,
  "touchMin": 44
} as const;

/** Raios do DS-APP.md §2.7. Sem sombra: a hierarquia vem das superficies. */
export const APP_RADIUS = {
  "sheet": 20,
  "card": 16,
  "control": 12,
  "segment": 8,
  "bar": 3,
  "progress": 2,
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
    "border": 0.32
  }
} as const;

export type AppTheme = keyof typeof APP_TOKENS;
export type AppTokens = (typeof APP_TOKENS)[AppTheme];
