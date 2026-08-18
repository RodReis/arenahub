import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'ArenaHub — Painel',
  description: 'Painel administrativo do ArenaHub',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * `data-surface` seleciona a camada de expressao; `data-mode`, a semantica
 * (DS-PAINEL.md §12). Ambos ficam no <html> renderizado no servidor: sem
 * provider de tema no cliente, sem flash de cor errada, sem `use client`.
 *
 * A rampa de accent do TENANT ainda nao entra aqui. Ela depende de
 * `getTenantTheme()`, que le a configuracao da academia -- trabalho da fatia
 * F42 (SPEC-042 §1). Ate la vale o fallback do theme.css: Ciano Arena,
 * resolvido por contraste no build.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-surface="panel" data-mode="light" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
