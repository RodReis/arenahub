'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import {
  alterarAtivacaoDePlano,
  type EstadoDaAtivacaoDePlano,
} from '../../actions/membership';

interface Props {
  readonly planId: string;
  readonly nomeDoPlano: string;
  readonly isActive: boolean;
}

const ESTADO_INICIAL: EstadoDaAtivacaoDePlano = {};

function BotaoDeAtivacao({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus();

  /*
   * DESTRUCTIVE só para desativar: reativar devolve um plano à lista de
   * escolha e não tira acesso de ninguém. Pintar as duas de vermelho ensinaria
   * que ambas são perigosas, e a recepção hesitaria na que é inofensiva.
   */
  return (
    <Button
      type="submit"
      variant={isActive ? 'destructive' : 'outline'}
      disabled={pending}
      data-testid={isActive ? 'confirmar-desativacao' : 'confirmar-reativacao'}
    >
      {pending ? 'Salvando…' : isActive ? 'Desativar' : 'Reativar'}
    </Button>
  );
}

/**
 * Liga e desliga o plano da lista de escolha.
 *
 * NÃO É EXCLUSÃO, e o rótulo diz isso: "Desativar", não "Excluir". Plano
 * apagado deixaria invoice e timeline antigas citando algo que não existe
 * mais, e o histórico financeiro é auditado (decisão do PI, 24/08/2026).
 *
 * SEM CONFIRMAÇÃO EM DOIS PASSOS: desativar não apaga nada e se desfaz com
 * um clique no botão que aparece no lugar. A confirmação fica reservada ao
 * que é irreversível -- gastá-la aqui ensinaria a recepção a clicar em "sim"
 * sem ler.
 */
export function AcaoDeAtivacao({ planId, nomeDoPlano, isActive }: Props) {
  const [estado, acao] = useActionState(alterarAtivacaoDePlano, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', `erro-de-ativacao-${planId}`);
  useToastDeErro(
    estado.sucesso
      ? estado.sucesso.isActive
        ? `${nomeDoPlano} reativado.`
        : `${nomeDoPlano} desativado.`
      : undefined,
    'info',
    `sucesso-de-ativacao-${planId}`,
  );

  return (
    <form action={acao}>
      <input type="hidden" name="planId" value={planId} />
      {/*
        O valor enviado é o DESTINO, não o estado atual: o botão "Desativar"
        manda `false`. Mandar o estado atual inverteria a ação -- e o toast
        diria o oposto do que aconteceu.
      */}
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <BotaoDeAtivacao isActive={isActive} />
    </form>
  );
}
