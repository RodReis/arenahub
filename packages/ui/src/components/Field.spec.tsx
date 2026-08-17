import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field } from './Field.js';

describe('Field', () => {
  it('associa rotulo ao controle -- clicar no rotulo foca o campo', () => {
    render(<Field id="email" label="E-mail" name="email" type="email" />);

    expect(screen.getByLabelText('E-mail')).toHaveAttribute('name', 'email');
  });

  it('unidade fica AO LADO do rotulo, nunca no placeholder -- §6', () => {
    render(<Field id="peso" label="Peso" name="peso" unit="kg" />);

    expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.getByLabelText(/Peso/)).not.toHaveAttribute('placeholder');
  });

  it('erro e anunciado e ligado ao campo por aria-describedby', () => {
    render(<Field id="cpf" label="CPF" name="cpf" error="CPF inválido." />);

    const campo = screen.getByLabelText('CPF');
    const erro = screen.getByText('CPF inválido.');

    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAttribute('aria-describedby', erro.id);
  });

  it('formulario nunca limpa dado em erro recuperavel -- §6', () => {
    render(
      <Field id="cpf" label="CPF" name="cpf" defaultValue="000.000.000-00" error="CPF inválido." />,
    );

    expect(screen.getByLabelText('CPF')).toHaveValue('000.000.000-00');
  });

  it('sem erro nao ha aria-invalid -- campo intacto nao se anuncia como quebrado', () => {
    render(<Field id="email" label="E-mail" name="email" />);

    expect(screen.getByLabelText('E-mail')).not.toHaveAttribute('aria-invalid');
  });

  it('dica descreve o campo sem virar erro', () => {
    render(<Field id="email" label="E-mail" name="email" hint="Use o e-mail do cadastro." />);

    const campo = screen.getByLabelText('E-mail');

    expect(campo).toHaveAttribute('aria-describedby', screen.getByText('Use o e-mail do cadastro.').id);
    expect(campo).not.toHaveAttribute('aria-invalid');
  });

  it('erro vence a dica na descricao -- quem errou precisa ouvir o erro', () => {
    render(
      <Field id="email" label="E-mail" name="email" hint="Use o e-mail do cadastro." error="Obrigatório." />,
    );

    expect(screen.getByLabelText('E-mail')).toHaveAttribute(
      'aria-describedby',
      screen.getByText('Obrigatório.').id,
    );
  });

  it('invalid marca o campo sem inventar frase -- erro unico anunciado fora dele', () => {
    // O login tem UMA frase de erro para o formulario inteiro. Repeti-la em
    // cada campo faria o leitor de tela anuncia-la tres vezes.
    const { container } = render(<Field id="email" label="E-mail" name="email" invalid />);

    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(container.querySelector('[id="email-erro"]')).toBeNull();
  });

  it('icone dentro do campo e decorativo -- o rotulo ja diz o que e', () => {
    const { container } = render(<Field id="email" label="E-mail" name="email" icon="mail" />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
