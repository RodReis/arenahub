import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

/*
 * A server action e o duble: `useActionState` a executa de verdade em jsdom
 * quando o formulario e submetido, e o retorno dela e o que a tela mostra.
 */
vi.mock('../../actions/edge-nodes', () => ({
  gerarCodigoDePareamento: vi.fn(),
}));

import { PareaEdge } from './parear-edge';

const EDGE_ID = '99999999-9999-4999-8999-999999999999';

function renderizar() {
  return render(
    <ToastProvider>
      <PareaEdge edgeNodeId={EDGE_ID} timeZone="America/Sao_Paulo" />
    </ToastProvider>,
  );
}

describe('acao de pareamento do Edge', () => {
  /*
   * PAREAMENTO NAO E EVENTO UNICO: o codigo tem TTL curto, morre no primeiro
   * uso e o ADR-011 preve revogacao pelo painel. Sem o botao na linha, um
   * Edge revogado so voltaria a funcionar cadastrando OUTRO -- duplicando o
   * registro e perdendo o historico (issue #404).
   */
  it('oferece parear um Edge ja cadastrado', () => {
    renderizar();

    expect(screen.getByTestId('parear-edge')).toBeInTheDocument();
  });

  /** Antes de gerar, nenhum codigo na tela. */
  it('nao mostra codigo antes de gerar', () => {
    renderizar();

    expect(screen.queryByTestId('codigo-de-pareamento')).not.toBeInTheDocument();
  });

  it('manda o Edge certo na acao', () => {
    const { container } = renderizar();

    const campo = container.querySelector('input[name="edgeNodeId"]');

    expect(campo).toHaveValue(EDGE_ID);
  });
});
