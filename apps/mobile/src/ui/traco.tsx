import Svg, { Path } from 'react-native-svg';

/**
 * Glifos de traco do App Mobile v2 -- os MESMOS `d` do prototipo.
 *
 * Um componente e um dicionario, e nao um arquivo por icone como `icones.tsx`:
 * o prototipo desenha tudo com um unico `<path>` de traco em `viewBox` 24x24,
 * e copiar o caminho literal e o que mantem o glifo identico ao desenho. Os
 * icones de ESTADO (badge) continuam em `icones.tsx`, que carrega a regra de
 * cor por tom.
 *
 * A cor entra sempre de fora e sempre de token -- este arquivo nao conhece cor.
 */
export const TRACOS = {
  marca: 'M2.5 9.5v5 M5 7.5v9 M19 7.5v9 M21.5 9.5v5 M5 12h3.2 M15.8 12H19 M8.2 12l1.4-2.6 1.9 5.2 1.7-4 1 1.4h1.6',
  corpo: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 8h8l-1 6h-6z M9 14v7 M15 14v7 M6 10l2-2 M18 10l-2-2',
  evolucao: 'M3 17l5-6 4 4 5-8 4 5 M3 21h18',
  evolucaoAba: 'M3 17l5-6 4 4 5-8 4 5',
  trofeu: 'M8 21h8 M12 17v4 M7 4h10v4a5 5 0 0 1-10 0V4z M7 5H4v2a3 3 0 0 0 3 3 M17 5h3v2a3 3 0 0 1-3 3',
  cartao: 'M2.5 6.5h19v11h-19z M2.5 10.5h19 M6 14.5h4',
  inicio: 'M3 11l9-8 9 8 M5 9.5V21h14V9.5h-14',
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  chama: 'M12 3c1.2 3.6-3 5-3 8.6a3 3 0 0 0 6 .4c1.6 1.2 2.4 2.6 2.4 4a5.4 5.4 0 0 1-10.8 0C6.6 10.4 10.8 8.4 12 3z',
  alvo: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20 M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10 M12 12v.01',
  sino: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
  calendario: 'M3 5h18v16H3z M3 9h18 M8 3v4 M16 3v4',
  balanca: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8v4l2.5 2.5',
  voltar: 'M15 19l-7-7 7-7',
  avancar: 'M9 5l7 7-7 7',
  info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20 M12 11v5 M12 7.5v.01',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
} as const;

export type NomeDoTraco = keyof typeof TRACOS;

export function Traco({
  nome,
  cor,
  tamanho = 20,
  espessura = 2,
}: {
  nome: NomeDoTraco;
  cor: string;
  tamanho?: number;
  espessura?: number;
}) {
  return (
    <Svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cor}
      strokeWidth={espessura}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={TRACOS[nome]} />
    </Svg>
  );
}
