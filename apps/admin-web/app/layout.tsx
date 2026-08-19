import { ToastProvider } from '@arenahub/ui';
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
 * O `ToastProvider` mora AQUI, e nao no layout protegido: a regra do
 * CLAUDE.md ("sempre usar Toast para: Info, Warn e error") vale no projeto
 * inteiro, e o login fica fora de `(protected)`. Com o provider so la, o
 * `useToast` do formulario de login lancaria "useToast exige <ToastProvider>
 * acima na arvore" -- a tela de entrada quebraria ao errar a senha.
 *
 * Ele e Client Component filho de um Server Component, que e o arranjo
 * normal: o servidor renderiza a arvore e o provider hidrata so a si mesmo.
 *
 * A rampa de accent do TENANT ainda nao entra aqui. Ela depende de
 * `getTenantTheme()`, que le a configuracao da academia -- trabalho da fatia
 * F42 (SPEC-042 §1). Ate la vale o fallback do theme.css: Ciano Arena,
 * resolvido por contraste no build.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-surface="panel" data-mode="light" className={cn("font-sans", geist.variable)}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
