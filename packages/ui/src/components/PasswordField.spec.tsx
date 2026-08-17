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

    await usuario.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');

    await usuario.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  /**
   * REGRESSAO: o rotulo do botao NAO pode conter a palavra do rotulo do campo.
   *
   * Com "Mostrar senha", `getByLabel('Senha')` casa DOIS elementos -- o input e
   * o botao. Isso quebrou 10 E2E de uma vez, e o defeito nao e do teste: quem
   * navega por rotulo, leitor de tela incluido, fica com o campo ambiguo. O
   * `aria-describedby` no botao amarra os dois sem repetir a palavra.
   */
  it('o botao nao repete o rotulo do campo -- senao o campo vira ambiguo', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    expect(screen.getByLabelText('Senha').tagName).toBe('INPUT');
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/senha/i);
  });

  it('o botao diz o que vai acontecer, nao o estado atual', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    // Mascarado: a acao disponivel e MOSTRAR. Rotular de "Senha oculta"
    // descreveria o estado e deixaria quem usa leitor de tela sem saber que ha
    // uma acao ali.
    expect(screen.getByRole('button', { name: 'Mostrar' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('o toggle aponta para o campo que controla', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-controls', 'password');
  });

  it('o toggle nao envia o formulario', () => {
    render(<PasswordField id="password" label="Senha" name="password" />);

    expect(screen.getByRole('button', { name: 'Mostrar' })).toHaveAttribute('type', 'button');
  });

  it('erro chega ao campo como no Field', () => {
    render(<PasswordField id="password" label="Senha" name="password" error="Obrigatória." />);

    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Obrigatória.')).toBeInTheDocument();
  });
});
