import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { AlterarPerfil } from './alterar-perfil';

function renderizar(props: Partial<Parameters<typeof AlterarPerfil>[0]> = {}) {
  const acao = vi.fn(() => Promise.resolve({}));

  const utils = render(
    <ToastProvider>
      <AlterarPerfil
        nomeDoCampoDeId="teamMemberId"
        id="11111111-1111-4111-8111-111111111111"
        perfilAtual="TRAINER"
        version={0}
        acao={acao}
        {...props}
      />
    </ToastProvider>,
  );

  return { ...utils, acao };
}

describe('AlterarPerfil', () => {
  it('mostra o perfil atual pre-selecionado', () => {
    renderizar();

    expect(screen.getByTestId('campo-perfil')).toHaveValue('TRAINER');
  });

  it('oferece Aluno como destino, alem de professor/funcionario/administrador', () => {
    renderizar();

    const select = screen.getByTestId('campo-perfil');
    const opcoes = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

    expect(opcoes).toEqual(
      expect.arrayContaining(['Aluno', 'Professor', 'Funcionário', 'Administrador', 'Permuta-Tacio', 'Permuta-Douglas']),
    );
  });

  it('envia o campo oculto de id com o nome pedido', () => {
    const { container } = renderizar({ nomeDoCampoDeId: 'studentId', id: 'abc-123' });

    const campoOculto = container.querySelector('input[name="studentId"]');
    expect(campoOculto).toHaveValue('abc-123');
  });

  it('ao trocar e submeter, chama a action recebida', async () => {
    const usuario = userEvent.setup();
    const { acao } = renderizar();

    await usuario.selectOptions(screen.getByTestId('campo-perfil'), 'STUDENT');
    await usuario.click(screen.getByTestId('confirmar-perfil'));

    expect(acao).toHaveBeenCalled();
  });
});
