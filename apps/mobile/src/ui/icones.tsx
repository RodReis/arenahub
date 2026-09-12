import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { useTema, type Tom } from './theme.js';

/**
 * Icones -- DS-APP.md §2.9.
 *
 * Traco, `viewBox` 24x24, `strokeWidth` 2, pontas e juntas arredondadas, sem
 * preenchimento. Os tamanhos do §2.9 sao 13 (badge), 16 (tile e linha), 17
 * (botao primario) e 20 (tab bar).
 *
 * Cor: quando `tom` vem, usa a cor do estado (e o glifo que acompanha o badge
 * -- §7, cor nunca e o unico canal); sem `tom`, `accent/ink`, que o §2.3
 * reserva para TRACO DE ICONE. Nao usar `accent/text` aqui: o §2.3 diz
 * explicitamente "nao inverter, o mais claro e o que precisa de contraste em
 * corpo pequeno" -- texto pede o tom mais claro, traco de icone nao.
 *
 * O componente NUNCA recebe hex: a regra 1 do DS vale aqui como em qualquer
 * outro arquivo.
 */

type PropsDeIcone = {
  tamanho?: number;
  tom?: Tom;
  /** Usa a cor de texto em vez do accent -- para icone dentro de botao. */
  neutro?: boolean;
};

function useCorDoIcone({ tom, neutro }: PropsDeIcone): string {
  const t = useTema();
  if (tom) return t.cor.state[tom];
  if (neutro) return t.cor.text.primary;
  return t.cor.accent.ink;
}

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function Relogio(props: PropsDeIcone) {
  const cor = useCorDoIcone(props);
  const s = props.tamanho ?? 13;
  return (
    <Svg width={s} height={s} {...BASE} stroke={cor}>
      <Circle cx="12" cy="12" r="9" />
      <Polyline points="12 7 12 12 15.5 14" />
    </Svg>
  );
}

export function Check(props: PropsDeIcone) {
  const cor = useCorDoIcone(props);
  const s = props.tamanho ?? 13;
  return (
    <Svg width={s} height={s} {...BASE} stroke={cor}>
      <Polyline points="4 12.5 9.5 18 20 6.5" />
    </Svg>
  );
}

export function Alerta(props: PropsDeIcone) {
  const cor = useCorDoIcone(props);
  const s = props.tamanho ?? 13;
  return (
    <Svg width={s} height={s} {...BASE} stroke={cor}>
      <Path d="M12 3.5 22 20H2L12 3.5Z" />
      <Path d="M12 10v4" />
      <Path d="M12 17.2v.1" />
    </Svg>
  );
}

export function Bloqueio(props: PropsDeIcone) {
  const cor = useCorDoIcone(props);
  const s = props.tamanho ?? 13;
  return (
    <Svg width={s} height={s} {...BASE} stroke={cor}>
      <Path d="M6 11h12v9H6z" />
      <Path d="M8.5 11V7.5a3.5 3.5 0 1 1 7 0V11" />
    </Svg>
  );
}

export function Informacao(props: PropsDeIcone) {
  const cor = useCorDoIcone(props);
  const s = props.tamanho ?? 13;
  return (
    <Svg width={s} height={s} {...BASE} stroke={cor}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 11v5.5" />
      <Path d="M12 7.6v.1" />
    </Svg>
  );
}

/** O glifo que acompanha cada tom no badge -- §7: cor nunca e o unico canal. */
export const ICONE_DO_TOM = {
  ok: Check,
  warn: Alerta,
  err: Bloqueio,
  info: Relogio,
} as const;
