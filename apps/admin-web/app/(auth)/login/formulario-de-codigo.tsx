'use client';

import { useActionState } from 'react';

import { Button, Field, useToastDeErro } from '@arenahub/ui';

import type { EstadoDoSegundoFator } from '../../actions/auth';
import { cancelarSegundoFator } from '../../actions/auth';
import estilos from './login.module.css';

const ESTADO_INICIAL: EstadoDoSegundoFator = {};

interface Props {
  acao: (
    anterior: EstadoDoSegundoFator,
    formulario: FormData,
  ) => Promise<EstadoDoSegundoFator>;
  /** Verbo do botão -- "Entrar" ao verificar, "Ativar" ao configurar. */
  rotulo: string;
}

/**
 * O campo do código, compartilhado pelas duas telas do segundo fator.
 *
 * As telas diferem no que vem ANTES (a de configuração mostra o segredo a
 * cadastrar); o campo, a validação e o erro são os mesmos, e duplicá-los
 * deixaria as duas mensagens divergirem na primeira correção.
 */
export function FormularioDeCodigo({ acao, rotulo }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-de-segundo-fator');

  return (
    <form className={estilos['formulario']} action={enviar} noValidate>
      <Field
        id="code"
        name="code"
        label="Código do aplicativo"
        /*
         * `inputMode="numeric"` abre o teclado numérico no celular sem recusar
         * o espaço que o autenticador mostra ("123 456") -- a ação remove o
         * espaço antes de validar. `type="number"` traria setas de incremento
         * e perderia zero à esquerda.
         */
        inputMode="numeric"
        /*
         * `one-time-code` é o que faz o iOS e o Android oferecerem o código na
         * barra do teclado. Sem ele a pessoa alterna entre dois aplicativos
         * para digitar seis dígitos que já estavam na tela.
         */
        autoComplete="one-time-code"
        maxLength={7}
        required
        autoFocus
        invalid={Boolean(estado.erro)}
      />

      <Button type="submit" disabled={enviando}>
        {enviando ? 'Verificando...' : rotulo}
      </Button>

      {/*
        Sair do desafio é uma saída de verdade, não um link decorativo: a tela
        não tem campo de e-mail, então sem isto quem caiu na conta errada fica
        preso até o cookie vencer.

        `formAction` num botão do MESMO formulário evita um segundo `<form>`
        aninhado, que o HTML não permite.
      */}
      <Button type="submit" variant="ghost" formAction={cancelarSegundoFator}>
        Entrar com outra conta
      </Button>
    </form>
  );
}
