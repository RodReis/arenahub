import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PainelDeEstado } from './PainelDeEstado.js';

describe('PainelDeEstado', () => {
  it('expoe o tom para o CSS sem embutir cor no componente', () => {
    render(
      <PainelDeEstado rotulo="Situação atual" tom="danger" icone="alert-triangle" testId="painel">
        R$ 150,00
      </PainelDeEstado>,
    );

    expect(screen.getByTestId('painel')).toHaveAttribute('data-tom', 'danger');
  });

  /*
   * As DUAS INTENSIDADES sao a razao de o painel nao se diluir: se toda
   * superficie colorida pintasse o fundo inteiro, a que esta em alerta nao
   * teria como gritar mais alto. O atributo e o que o CSS le para decidir.
   */
  it('so marca alerta quando o proprio numero e o problema', () => {
    const { rerender } = render(
      <PainelDeEstado rotulo="Situação atual" tom="warning" icone="clock" testId="painel">
        R$ 150,00
      </PainelDeEstado>,
    );

    expect(screen.getByTestId('painel')).not.toHaveAttribute('data-alerta');

    rerender(
      <PainelDeEstado
        rotulo="Situação atual"
        tom="danger"
        icone="alert-triangle"
        emAlerta
        testId="painel"
      >
        R$ 150,00
      </PainelDeEstado>,
    );

    expect(screen.getByTestId('painel')).toHaveAttribute('data-alerta', 'true');
  });

  /*
   * COR NUNCA E CANAL UNICO (`M1-NFR-008`). O selo e decorativo e o rotulo
   * textual e quem informa -- um leitor de tela que anunciasse "icone de
   * triangulo" antes de "Situacao atual" so atrasaria a leitura.
   */
  it('esconde o selo do leitor de tela e mantem o rotulo como canal textual', () => {
    const { container } = render(
      <PainelDeEstado rotulo="Situação atual" tom="danger" icone="alert-triangle" testId="painel">
        R$ 150,00
      </PainelDeEstado>,
    );

    expect(screen.getByText('Situação atual')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('nao renderiza a linha de apoio quando nao ha o que apoiar', () => {
    const { container, rerender } = render(
      <PainelDeEstado rotulo="Situação atual" tom="success" icone="check-circle" testId="painel">
        Nenhuma cobrança em aberto
      </PainelDeEstado>,
    );

    expect(container.querySelectorAll('[data-testid="painel"] > div')).toHaveLength(2);

    rerender(
      <PainelDeEstado
        rotulo="Situação atual"
        tom="danger"
        icone="alert-triangle"
        testId="painel"
        apoio={<strong>111 dias de atraso</strong>}
      >
        R$ 150,00
      </PainelDeEstado>,
    );

    expect(screen.getByText('111 dias de atraso')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="painel"] > div')).toHaveLength(3);
  });
});
