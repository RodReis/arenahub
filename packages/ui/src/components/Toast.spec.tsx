import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ToastProvider, useToast } from './Toast.js';

function Disparador() {
  const { show } = useToast();

  return (
    <>
      <button type="button" onClick={() => show('error', 'Falha ao salvar')}>
        erro
      </button>
      <button type="button" onClick={() => show('info', 'Aluno cadastrado')}>
        info
      </button>
      <button type="button" onClick={() => show('warn', 'Dado desatualizado')}>
        warn
      </button>
    </>
  );
}

function montar() {
  return render(
    <ToastProvider>
      <Disparador />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  it('mostra a mensagem depois do disparo', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'info' }));

    expect(await screen.findByText('Aluno cadastrado')).toBeInTheDocument();
  });

  /**
   * Erro INTERROMPE o leitor de tela; confirmacao espera a pausa.
   *
   * "Falha ao salvar" precisa chegar antes de a pessoa sair da pagina.
   * Interromper a cada sucesso tornaria o painel insuportavel para quem
   * depende de leitor de tela.
   */
  it('erro usa role=alert; info usa role=status', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'erro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao salvar');

    await userEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Aluno cadastrado');
  });

  it('empilha varios toasts sem colidir chave', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'info' }));
    await userEvent.click(screen.getByRole('button', { name: 'warn' }));

    expect(await screen.findByText('Aluno cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Dado desatualizado')).toBeInTheDocument();
  });

  it('da para dispensar pelo teclado', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'info' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }));

    expect(screen.queryByText('Aluno cadastrado')).not.toBeInTheDocument();
  });

  it('exige o provider -- toast solto sem regiao nao anuncia nada', () => {
    // O erro precisa aparecer no desenvolvimento, nao virar toast que some.
    expect(() => render(<Disparador />)).toThrow(/ToastProvider/);
  });
});
