import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { NumeroEmDestaque } from './numero-em-destaque';

function renderizar(vinculado?: boolean) {
  return render(
    <ToastProvider>
      <NumeroEmDestaque numero="100000000007" {...(vinculado === undefined ? {} : { vinculado })} />
    </ToastProvider>,
  );
}

describe('NumeroEmDestaque', () => {
  it('mostra o numero em blocos de 3 so na tela', () => {
    renderizar();

    const saida = screen.getByTestId('numero-em-destaque-valor');
    expect(saida.textContent?.replace(/\s/g, '')).toBe('100000000007');
    expect(saida.querySelectorAll('span')).toHaveLength(4);
  });

  it('copiar escreve os digitos sem espaco e avisa por toast', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderizar();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número' }));

    expect(writeText).toHaveBeenCalledWith('100000000007');
    await waitFor(() => expect(screen.getByText('Número copiado')).toBeInTheDocument());
  });

  it('sem Clipboard API (http na rede local) avisa por toast e nao estoura', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    renderizar();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número' }));

    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível copiar. Selecione o número e copie manualmente.'),
      ).toBeInTheDocument(),
    );
  });

  it('writeText recusado avisa por toast', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('negado')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderizar();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número' }));

    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível copiar. Selecione o número e copie manualmente.'),
      ).toBeInTheDocument(),
    );
  });

  it('vinculado diz que o leitor ja tem o numero', () => {
    renderizar(true);
    expect(screen.getByText(/já está vinculado ao leitor/)).toBeInTheDocument();
  });

  it('sem vinculo pede o cadastro da face no leitor', () => {
    renderizar(false);
    expect(screen.getByText('Agora cadastre a face no leitor com este número.')).toBeInTheDocument();
  });

  it('sem a prop vinculado nao promete nada sobre o leitor', () => {
    renderizar();
    expect(screen.queryByText(/leitor/)).not.toBeInTheDocument();
  });
});
