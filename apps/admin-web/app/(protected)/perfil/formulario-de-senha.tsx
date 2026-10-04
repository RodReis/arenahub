'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToast } from '@arenahub/ui';

import { alterarSenha, type EstadoDaSenha } from '../../actions/perfil';
import estilos from './perfil.module.css';

const ESTADO_INICIAL: EstadoDaSenha = {};

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="salvar-senha">
      {pending ? 'Salvando…' : 'Alterar senha'}
    </Button>
  );
}

/**
 * Troca da propria senha -- SPEC-084.
 *
 * CAMPOS NAO CONTROLADOS, e por isso o sucesso limpa pelo `form.reset()`: a
 * action nao devolve senha nenhuma (prop serializada volta no HTML), e quem
 * acabou de trocar nao deve ver a senha velha ainda digitada.
 *
 * SEM `required` NATIVO: a validacao e da action, com a frase certa em toast.
 *
 * O ERRO NAO USA `useToastDeErro`: o hook compara a MENSAGEM, e aqui o erro
 * REPETIDO e o caso comum -- errar a senha atual duas vezes. Com a mensagem
 * igual o efeito nao reexecuta, e quem dispensou o primeiro toast fica diante
 * de um botao que parece morto. A action devolve um objeto NOVO a cada envio,
 * entao o efeito depende do `estado` inteiro.
 */
export function FormularioDeSenha() {
  const [estado, acao] = useActionState(alterarSenha, ESTADO_INICIAL);
  const formulario = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.erro) show('error', estado.erro, 'erro-da-senha');
  }, [estado, show]);

  useEffect(() => {
    if (!estado.sucesso) return;

    formulario.current?.reset();
    show('info', 'Senha alterada. As outras sessões serão encerradas.', 'senha-trocada');
  }, [estado.sucesso, show]);

  return (
    <form ref={formulario} action={acao} className={estilos['formulario']} noValidate>
      <Field
        id="senha-atual"
        name="senhaAtual"
        label="Senha atual"
        type="password"
        autoComplete="current-password"
        data-testid="campo-senha-atual"
      />
      <Field
        id="nova-senha"
        name="novaSenha"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        data-testid="campo-nova-senha"
      />
      <Field
        id="confirmacao-de-senha"
        name="confirmacao"
        label="Confirmar nova senha"
        type="password"
        autoComplete="new-password"
        data-testid="campo-confirmacao"
      />
      <p className={estilos['dica']}>
        Mínimo de 8 caracteres. Ao alterar, você continua conectado aqui e as outras sessões são
        encerradas.
      </p>
      <div className={estilos['acoes']}>
        <BotaoDeSalvar />
      </div>
    </form>
  );
}
