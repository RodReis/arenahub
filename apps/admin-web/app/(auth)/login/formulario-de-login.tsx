'use client';

import { useActionState } from 'react';

import { entrar, type EstadoDoFormulario } from '../../actions/auth';

const ESTADO_INICIAL: EstadoDoFormulario = {};

/**
 * Client Component so pelo estado do formulario -- o resto da tela e
 * servidor. A senha nunca vira prop nem parametro de URL.
 */
export function FormularioDeLogin() {
  const [estado, acao, enviando] = useActionState(entrar, ESTADO_INICIAL);

  return (
    <form action={acao} noValidate>
      {estado.erro ? (
        // `alert` + `tabIndex` para o leitor de tela anunciar e o teclado
        // alcancar. Erro que so muda a cor da borda nao existe para quem
        // navega por teclado ou nao distingue cores.
        <p role="alert" tabIndex={-1} data-testid="erro-de-login">
          {estado.erro}
        </p>
      ) : null}

      <div>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={estado.email ?? ''}
          aria-invalid={estado.erro ? true : undefined}
        />
      </div>

      <div>
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={estado.erro ? true : undefined}
        />
      </div>

      <button type="submit" disabled={enviando}>
        {enviando ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
