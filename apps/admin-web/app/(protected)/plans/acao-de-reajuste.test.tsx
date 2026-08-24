import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { AcaoDeReajuste } from './acao-de-reajuste';

vi.mock('../../actions/membership', () => ({
  reajustarPreco: vi.fn(),
}));

/**
 * `jsdom` NAO implementa `showModal`/`close` do `<dialog>`. Sem estes dublês
 * o teste estoura com "showModal is not a function" -- o `open` e alternado
 * a mao porque e dele que a visibilidade do conteudo depende.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function fechar(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const PLANO_ID = 'plano-1';

const PADRAO = {
  planId: PLANO_ID,
  nomeDoPlano: 'Clinica de Musculacao',
  unidades: ['Unidade Matriz'],
  historico: [{ amountMinor: 15000, currency: 'BRL', validFrom: '2026-01-01T00:00:00.000Z' }],
  timeZone: 'America/Sao_Paulo',
};

function renderizar(props: Partial<Parameters<typeof AcaoDeReajuste>[0]> = {}) {
  return render(
    <ToastProvider>
      <AcaoDeReajuste {...PADRAO} {...props} />
    </ToastProvider>,
  );
}

async function abrir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByTestId(`abrir-reajuste-${PLANO_ID}`));
}

describe('AcaoDeReajuste', () => {
  /**
   * O MODAL COBRE A TABELA. Sem dizer de qual plano se trata, quem abre a
   * partir da quinta linha nao tem como conferir que clicou na certa -- e o
   * erro so apareceria depois de reajustar o preco errado.
   */
  it('diz de qual plano e de qual unidade se trata', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByText('Clinica de Musculacao')).toBeInTheDocument();
    expect(screen.getByText(/Unidade Matriz/)).toBeInTheDocument();
  });

  /**
   * PLANO SEM UNIDADE NAO LIBERA ACESSO EM LUGAR NENHUM: a janela de horario
   * e por unidade, e sem nenhuma o entitlement nasce sem onde valer.
   *
   * A primeira versao OMITIA a unidade quando nao havia -- e a ausencia
   * silenciosa parecia "ainda nao carregou", justamente no caso em que o
   * dado importa mais.
   */
  it('diz "nenhuma" quando o plano nao tem unidade, em vez de omitir', async () => {
    const usuario = userEvent.setup();

    renderizar({ unidades: [] });
    await abrir(usuario);

    expect(screen.getByTestId(`plano-sem-unidade-${PLANO_ID}`)).toHaveTextContent(
      /não libera acesso/i,
    );
  });

  it('lista todas as unidades quando ha mais de uma', async () => {
    const usuario = userEvent.setup();

    renderizar({ unidades: ['Matriz', 'Zona Sul'] });
    await abrir(usuario);

    expect(screen.getByText(/Matriz, Zona Sul/)).toBeInTheDocument();
  });

  /**
   * O HISTORICO fica a vista ANTES de reajustar: quem muda o preco precisa
   * ver o que ja valeu, senao decide as cegas sobre o que virou vigencia.
   */
  it('mostra o historico de vigencias dentro do modal', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByTestId(`historico-de-vigencias-lista-${PLANO_ID}`)).toHaveTextContent(
      'R$ 150,00',
    );
  });

  it('comeca fechado, mostrando so o botao', () => {
    renderizar();

    expect(screen.getByTestId(`abrir-reajuste-${PLANO_ID}`)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });
});
