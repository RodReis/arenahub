/**
 * Conjunto FECHADO de icones, inline, sem dependencia externa.
 *
 * Nao instalamos `lucide-react` nem equivalente: o painel usa ~20 icones de um
 * catalogo de milhares, e a arvore inteira entraria no bundle do Server
 * Component. Uniao literal em vez de `string` faz o compilador recusar nome
 * inexistente -- icone que nao renderiza vira erro de build, nao quadrado vazio
 * em producao.
 *
 * Traçado do Lucide (ISC), redesenhado em 24x24 com stroke 2.
 */
export const ICON_NAMES = [
  'check-circle',
  'x-circle',
  'alert-circle',
  'alert-triangle',
  'clock',
  'minus',
  'ban',
  'user-check',
  'user-minus',
  'user-x',
  'user-plus',
  'key-round',
  'scan-face',
  'wifi',
  'wifi-off',
  'copy',
  'refresh-cw',
  'archive',
  'calendar-x',
  'hourglass',
  'mail',
  'lock',
  'eye',
  'eye-off',
  'dumbbell',
] as const;

/**
 * O tipo DERIVA da lista, nunca o contrario.
 *
 * Com a uniao escrita a mao ao lado do array, as duas divergem no primeiro
 * icone novo -- e a que o teste percorre seria a desatualizada, deixando o
 * icone recem-adicionado sem cobertura justamente na entrega em que ele
 * chegou.
 */
export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, readonly string[]> = {
  'check-circle': ['M21.8 10A10 10 0 1 1 17 3.34', 'm9 11 3 3L22 4'],
  'x-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm15 9-6 6', 'm9 9 6 6'],
  'alert-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 8v4', 'M12 16h.01'],
  'alert-triangle': [
    'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z',
    'M12 9v4',
    'M12 17h.01',
  ],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'],
  minus: ['M5 12h14'],
  ban: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm4.9 4.9 14.2 14.2'],
  'user-check': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'm16 11 2 2 4-4',
  ],
  'user-minus': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M22 11h-6',
  ],
  'user-x': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'm17 8 5 5',
    'm22 8-5 5',
  ],
  'user-plus': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M19 8v6',
    'M22 11h-6',
  ],
  'key-round': [
    'M2.6 13.4A6 6 0 0 1 11 5a6 6 0 0 1 8.5 8.5L21 15l-2 2-2-2-2 2-2-2-2 2-2.6-2.6z',
    'M7.5 15.5h.01',
  ],
  'scan-face': [
    'M3 7V5a2 2 0 0 1 2-2h2',
    'M17 3h2a2 2 0 0 1 2 2v2',
    'M21 17v2a2 2 0 0 1-2 2h-2',
    'M7 21H5a2 2 0 0 1-2-2v-2',
    'M9 10h.01',
    'M15 10h.01',
    'M9 15c.8.6 1.9 1 3 1s2.2-.4 3-1',
  ],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 20h.01'],
  'wifi-off': ['m2 2 20 20', 'M8.5 16a5 5 0 0 1 7 0', 'M12 20h.01', 'M5 12.5a10 10 0 0 1 3-2'],
  copy: ['M9 9h10v10H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  'refresh-cw': ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  archive: ['M3 3h18v4H3z', 'M5 7v13h14V7', 'M10 12h4'],
  'calendar-x': ['M3 5h18v16H3z', 'M8 3v4', 'M16 3v4', 'M3 10h18', 'm10 14 4 4', 'm14 14-4 4'],
  hourglass: ['M6 2h12', 'M6 22h12', 'M8 2c0 5 8 5 8 10s-8 5-8 10'],
  mail: ['M2 5h20v14H2z', 'm2 6 10 7 10-7'],
  lock: ['M4 11h16v10H4z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  'eye-off': [
    'm2 2 20 20',
    'M6.7 6.7C3.9 8.4 2 12 2 12s4 7 10 7c2 0 3.7-.8 5.1-1.8',
    'M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-2.8 3.6',
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  /**
   * Halter na HORIZONTAL, nao na diagonal. O tracado diagonal do Lucide vira
   * rabisco a 16 px -- as barras das pontas somem e sobra um X. Redesenhado
   * reto: barra central, dois pesos, dois colares.
   */
  dumbbell: ['M6 6v12', 'M18 6v12', 'M3 9v6', 'M21 9v6', 'M6 12h12'],
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
