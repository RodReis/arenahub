'use client';

import { useState, type InputHTMLAttributes } from 'react';

import { Field } from './Field.js';
import { Icon } from './Icon.js';
import estilos from './PasswordField.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  /** Ver `Field` -- marca invalido sem frase propria. */
  readonly invalid?: boolean;
}

/**
 * Campo de senha com revelar -- `'use client'` pelo estado do toggle.
 *
 * Existe separado do `Field` justamente para o `Field` seguir Server
 * Component: um unico `useState` aqui dentro arrastaria todo campo do painel
 * para o bundle do cliente.
 *
 * Nasce MASCARADO. Revelar por padrao entregaria a senha a quem esta atras da
 * recepcao, que e exatamente o cenario do balcao.
 */
export function PasswordField({ id, label, ...resto }: Props) {
  const [revelada, setRevelada] = useState(false);

  return (
    /*
     * `hint` e `error` seguem dentro de `resto`: repassa-los nomeados
     * injetaria `undefined` explicito, que o `exactOptionalPropertyTypes`
     * recusa.
     */
    <Field
      {...resto}
      id={id}
      label={label}
      icon="lock"
      type={revelada ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className={estilos['revelar']}
          /**
           * O rotulo diz a ACAO disponivel, nao o estado atual: "Senha oculta"
           * descreveria a situacao e deixaria quem usa leitor de tela sem
           * saber que ha um botao ali. `aria-pressed` carrega o estado.
           *
           * E NAO repete a palavra do rotulo do campo. "Mostrar senha" fazia
           * `getByLabel('Senha')` casar o input E o botao -- campo ambiguo para
           * quem navega por rotulo. `aria-controls` amarra os dois sem
           * duplicar a palavra.
           */
          aria-label={revelada ? 'Ocultar' : 'Mostrar'}
          aria-controls={id}
          aria-pressed={revelada}
          onClick={() => setRevelada((atual) => !atual)}
        >
          <Icon name={revelada ? 'eye-off' : 'eye'} />
        </button>
      }
    />
  );
}
