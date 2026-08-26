import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

/**
 * Inter para a interface, JetBrains Mono APENAS para o campo de CPF
 * (DS-TOTEM.md §2.2 -- leitura digito a digito). Duas famílias, o teto do
 * contrato; o `variable` alimenta `--tt-fonte`/`--tt-fonte-mono` do
 * globals.css.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--tt-fonte-carregada',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--tt-fonte-mono-carregada',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ArenaHub — Totem',
  description: 'Totem de autoatendimento do ArenaHub',
};

/**
 * `userScalable: false` e deliberado e NAO e o antipadrao de acessibilidade
 * usual: o totem e um painel de 1080x1920 fixo, em pe, sem teclado -- pinca
 * de zoom so consegue tirar o conteudo do enquadramento sem forma de voltar.
 * A legibilidade e resolvida pela escala (minimo 19 px), nao pelo zoom.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * `data-surface="totem"` seleciona o bloco de tokens desta superficie no
 * `theme.css` -- renderizado no servidor, sem flash de cor errada.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR" data-surface="totem" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
