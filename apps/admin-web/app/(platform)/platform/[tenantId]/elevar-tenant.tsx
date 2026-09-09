'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { elevarSuporte, type EstadoDaElevacao } from '../../../actions/platform';

const ESTADO_INICIAL: EstadoDaElevacao = {};

interface Props {
  readonly tenantId: string;
  readonly displayName: string;
}

function BotaoDeConfirmacao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-elevacao">
      {pending ? 'Entrando…' : 'Entrar como suporte'}
    </Button>
  );
}

/**
 * Entrada de suporte na academia — F61, INV-005.
 *
 * DIÁLOGO E NÃO BOTÃO DIRETO: entrar no tenant do cliente é o ato mais pesado
 * desta tela, e um clique único o transformaria em acidente. A justificativa
 * não é burocracia — é o que a academia vê na própria auditoria quando
 * pergunta quem mexeu.
 *
 * Depois de confirmar, a API troca o cookie de acesso e a Server Action leva
 * para `/dashboard`, já dentro da academia e com a faixa de suporte no topo.
 */
export function ElevarTenant({ tenantId, displayName }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(elevarSuporte, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-elevacao');

  if (!aberto) {
    return (
      <div className={estilos['acoes']}>
        <Button variant="outline" onClick={() => setAberto(true)} data-testid="elevar">
          Entrar como suporte
        </Button>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <input type="hidden" name="tenantId" value={tenantId} />

      <fieldset className={estilos['grupo']}>
        <legend>Entrar como suporte em {displayName}</legend>

        <p className={estilos['nota']}>
          Você passa a operar dentro desta academia por tempo limitado, com uma faixa visível no
          topo. A entrada e a saída aparecem na auditoria da academia.
        </p>

        <TextareaField
          id="justificativa-da-elevacao"
          name="reason"
          label="Justificativa"
          required
          hint="Ao menos 10 caracteres. Ex.: chamado, combinado por telefone."
          data-testid="justificativa"
        />

        <div className={estilos['acoes']}>
          <BotaoDeConfirmacao />
          <Button variant="ghost" onClick={() => setAberto(false)} data-testid="cancelar-elevacao">
            Cancelar
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
