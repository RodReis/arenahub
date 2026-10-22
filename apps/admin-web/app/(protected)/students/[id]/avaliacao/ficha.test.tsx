import { ToastProvider } from '@arenahub/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const salvarFicha = vi.hoisted(() => vi.fn());

vi.mock('../../../../actions/avaliacao-fisica', () => ({ salvarFicha }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { FichaDeAvaliacao } from './ficha';

function renderizar(props: Partial<Parameters<typeof FichaDeAvaliacao>[0]> = {}) {
  return render(
    <ToastProvider>
      <FichaDeAvaliacao
        studentId="11111111-1111-4111-8111-111111111111"
        nascimento="1986-01-10"
        sexo="MALE"
        hoje="2026-10-22"
        outrosRascunhos={[]}
        {...props}
      />
    </ToastProvider>,
  );
}

describe('ficha de avaliação', () => {
  it('lê o IMC ao vivo, com a faixa da tabela', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByLabelText(/Peso/), '86,4');
    await user.type(screen.getByLabelText(/Estatura/), '178');

    const imc = within(screen.getByTestId('leitura-imc'));
    expect(imc.getByText('27,3')).toBeInTheDocument();
    expect(imc.getByText('Sobrepeso')).toBeInTheDocument();
  });

  it('sem valor, diz o que falta em vez de mostrar zero', () => {
    renderizar();

    const imc = within(screen.getByTestId('leitura-imc'));
    expect(imc.getByText('—')).toBeInTheDocument();
    expect(imc.getByText('Preencha peso e estatura.')).toBeInTheDocument();
  });

  it('as zonas de Karvonen saem da idade do cadastro e da FC de repouso', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByLabelText(/FC de repouso/), '60');

    // 40 anos: FCmáx 180, RFC 120 — o exemplo da própria folha.
    expect(screen.getByTestId('leitura-fcmax')).toHaveTextContent('180');
    expect(screen.getByTestId('leitura-rfc')).toHaveTextContent('120');
    expect(within(screen.getByTestId('zonas')).getByText('Leve')).toBeInTheDocument();
  });

  it('número inválido acusa no campo e não envia', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByLabelText(/Peso/), '8x');
    await user.click(screen.getByTestId('salvar-rascunho'));

    expect(screen.getByText('Use só número maior que zero, com vírgula.')).toBeInTheDocument();
    expect(salvarFicha).not.toHaveBeenCalled();
  });

  it('reabre o rascunho com os valores gravados', () => {
    renderizar({
      rascunho: {
        id: '33333333-3333-4333-8333-333333333333',
        assessedOn: '2026-10-20',
        notes: '',
        medidas: { WEIGHT: 72.5 },
      },
    });

    expect(screen.getByLabelText(/Peso/)).toHaveValue('72,5');
    expect(screen.getByLabelText('Data da avaliação')).toBeDisabled();
  });
});
