import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import {
  APP_MOTION,
  APP_RADIUS,
  APP_SIZE,
  APP_SPACE,
  APP_STATE_TINT,
  APP_TOKENS,
  APP_TYPE,
  type AppTheme,
} from '@arenahub/ui/app-tokens';

/**
 * O tema do app do aluno.
 *
 * Escuro e o PADRAO (DS-APP.md §1), e o app segue o SO a partir daqui
 * (§2.4.1). `useColorScheme` devolve `null` enquanto o sistema nao responde:
 * nesse instante o app cai em escuro, nao em claro -- quem abre o app no
 * vestiario nao leva um lampejo branco na cara.
 */

export type Tom = 'ok' | 'warn' | 'err' | 'info';

export interface Tema {
  readonly nome: AppTheme;
  readonly cor: (typeof APP_TOKENS)[AppTheme];
  readonly size: typeof APP_SIZE;
  readonly radius: typeof APP_RADIUS;
  readonly space: typeof APP_SPACE;
  readonly type: typeof APP_TYPE;
  readonly motion: typeof APP_MOTION;
  /**
   * Fundo e borda do badge de estado (§2.4), calculados a partir do tom.
   *
   * Nao sao tokens fixos porque sao DERIVADOS: a tripla `[texto, fundo 16%,
   * borda 34%]` do DS e uma receita, e materializar doze hex no JSON
   * multiplicaria por tres o que ja e conferido pelo gate de contraste. O
   * pipeline mede exatamente este par -- o texto do tom sobre o fundo que
   * esta funcao produz.
   */
  readonly tint: (tom: Tom) => { readonly bg: string; readonly border: string };
}

/**
 * `rgba` a partir do hex do tom.
 *
 * React Native aceita `rgba()` em string de cor, entao nao ha necessidade de
 * misturar a cor com a superficie na mao como o CSS do painel faz com
 * `color-mix`. A diferenca importa para o gate: o build MISTURA (porque
 * precisa de um hex opaco para medir luminancia) e o runtime SOBREPOE. Os
 * dois chegam ao mesmo pixel, porque a superficie sob o badge e sempre
 * `bg/surface` -- que e o fundo contra o qual o build mistura.
 */
const rgba = (hex: string, alpha: number): string => {
  const c = hex.replace('#', '');
  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const criarTema = (nome: AppTheme): Tema => {
  const cor = APP_TOKENS[nome];
  const opacidade = nome === 'dark' ? APP_STATE_TINT.dark : APP_STATE_TINT.light;

  return {
    nome,
    cor,
    size: APP_SIZE,
    radius: APP_RADIUS,
    space: APP_SPACE,
    type: APP_TYPE,
    motion: APP_MOTION,
    tint: (tom) => ({
      bg: rgba(cor.state[tom], opacidade.bg),
      border: rgba(cor.state[tom], opacidade.border),
    }),
  };
};

const TEMA_ESCURO = criarTema('dark');
const TEMA_CLARO = criarTema('light');

const TemaContext = createContext<Tema>(TEMA_ESCURO);

export function ProvedorDeTema({
  children,
  forcarTema,
}: {
  children: ReactNode;
  /** So para teste e para a tela de demonstracao. A producao segue o SO. */
  forcarTema?: AppTheme;
}) {
  const doSistema = useColorScheme();
  const tema = useMemo(() => {
    if (forcarTema) return forcarTema === 'dark' ? TEMA_ESCURO : TEMA_CLARO;
    // `null` (sistema ainda nao respondeu) cai em escuro -- o padrao do §1.
    return doSistema === 'light' ? TEMA_CLARO : TEMA_ESCURO;
  }, [doSistema, forcarTema]);

  return <TemaContext.Provider value={tema}>{children}</TemaContext.Provider>;
}

export const useTema = (): Tema => useContext(TemaContext);
