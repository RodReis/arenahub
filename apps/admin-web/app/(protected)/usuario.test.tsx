import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Usuario, iniciais } from './usuario';

describe('Usuario', () => {
  it('o chip da topbar leva ao perfil e continua mostrando o e-mail', () => {
    render(<Usuario email="douglas@arenapositiva.com.br" />);

    expect(screen.getByTestId('link-do-perfil')).toHaveAttribute('href', '/perfil');
    expect(screen.getByTestId('usuario-logado')).toHaveTextContent('douglas@arenapositiva.com.br');
  });

  it.each([
    ['douglas@arenapositiva.com.br', 'D'],
    ['ana.souza@exemplo.test', 'AS'],
    ['joao-pedro@exemplo.test', 'JP'],
  ])('iniciais de %s', (email, esperado) => {
    expect(iniciais(email)).toBe(esperado);
  });
});
