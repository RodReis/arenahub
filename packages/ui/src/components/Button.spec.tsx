import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.js';

describe('Button', () => {
  /**
   * `type="button"` por padrao.
   *
   * O default do HTML e `submit`. Um botao secundario dentro de `<form>` --
   * "Cancelar", "Voltar e corrigir" -- envia o formulario sem que ninguem
   * tenha escrito `type`, e o bug so aparece na primeira vez que alguem clica
   * no botao errado com o formulario preenchido.
   */
  it('type=button por padrao -- dentro de form, submit acidental e bug classico', () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('respeita type explicito', () => {
    render(<Button type="submit">Enviar</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('expoe a variante para o CSS', () => {
    render(<Button variant="destructive">Revogar biometria</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'destructive');
  });

  it('solid e a variante padrao -- acao primaria e o caso comum', () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'solid');
  });

  it('desabilitado continua legivel pelo leitor de tela', () => {
    render(<Button disabled>Salvar</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('repassa o resto das props do botao nativo', () => {
    render(
      <Button aria-describedby="ajuda" name="acao" value="salvar">
        Salvar
      </Button>,
    );

    const botao = screen.getByRole('button');

    expect(botao).toHaveAttribute('aria-describedby', 'ajuda');
    expect(botao).toHaveAttribute('name', 'acao');
  });
});
