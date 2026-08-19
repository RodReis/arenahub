'use client';

import { useActionState } from 'react';

import { Button, Field, PasswordField, useToastDeErro } from '@arenahub/ui';

import { entrar, type EstadoDoFormulario } from '../../actions/auth';
import estilos from './login.module.css';

const ESTADO_INICIAL: EstadoDoFormulario = {};

/**
 * Client Component so pelo estado do formulario -- o resto da tela e
 * servidor. A senha nunca vira prop nem parametro de URL.
 */
export function FormularioDeLogin() {
  const [estado, acao, enviando] = useActionState(entrar, ESTADO_INICIAL);
  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast ja carrega `role="alert"`, entao o anuncio ao leitor de
  // tela nao regride com a saida do `<p role="alert">`.
  useToastDeErro(estado.erro, 'error', 'erro-de-login');


  return (
    <form className={estilos['formulario']} action={acao} noValidate>
      <Field
        id="email"
        name="email"
        label="E-mail"
        type="email"
        icon="mail"
        autoComplete="username"
        required
        /*
         * O e-mail digitado volta ao campo -- §6: formulario nunca limpa dado
         * em erro recuperavel. A senha NAO volta, e a diferenca e proposital:
         * senha devolvida como prop reapareceria no HTML da pagina.
         */
        defaultValue={estado.email ?? ''}
        invalid={Boolean(estado.erro)}
      />

      <PasswordField
        id="password"
        name="password"
        label="Senha"
        autoComplete="current-password"
        required
        invalid={Boolean(estado.erro)}
      />

      <Button type="submit" disabled={enviando}>
        {enviando ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}
