import type { Metadata } from 'next';

import { PainelDeEntrada } from './painel-de-entrada';
import { MARCA_ARENAHUB } from '../../../src/marca/ler-marca';

export const metadata: Metadata = {
  title: 'Entrar — ArenaHub',
};

/**
 * Login sem slug — a marca é a do ArenaHub (ADR-052 §10).
 *
 * A tela em si mora em `PainelDeEntrada`, compartilhada com `/{slug}/login`:
 * o que muda entre as duas rotas é só qual marca entra na coluna da esquerda.
 */
export default function PaginaDeLogin() {
  return <PainelDeEntrada marca={MARCA_ARENAHUB} />;
}
