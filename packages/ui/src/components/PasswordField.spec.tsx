import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PasswordField } from './PasswordField.js';

describe('PasswordField', () => {
  it('nasce mascarado -- senha visivel por padrao vaza para quem esta atras', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  it('revela e volta a esconder', async () => {
    const usuario = userEvent.setup();
    render(<PasswordField id="password" label="Senha" name="password" />);

    await usuario.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');

    await usuario.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  it('o botao diz o que vai acontecer, nao o estado atual', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    // Mascarado: a acao disponivel e MOSTRAR. Rotular de "Senha oculta"
    // descreveria o estado e deixaria quem usa leitor de tela sem saber que ha
    // uma acao ali.
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('o toggle nao envia o formulario', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toHaveAttribute('type', 'button');
  });

  it('erro chega ao campo como no Field', () => {
    render(<PasswordField id="password" label="Senha" name="password" error="Obrigatória." />);

    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Obrigatória.')).toBeInTheDocument();
  });
});
