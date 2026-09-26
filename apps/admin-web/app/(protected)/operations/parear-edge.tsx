'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, TenantDateTime, useToastDeErro } from '@arenahub/ui';

import {
  gerarCodigoDePareamento,
  type EstadoDoPareamento,
} from '../../actions/edge-nodes';

const ESTADO_INICIAL: EstadoDoPareamento = {};

function Botao({ jaGerado }: { readonly jaGerado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending} data-testid="parear-edge">
      {pending ? 'Gerando…' : jaGerado ? 'Gerar outro' : 'Parear'}
    </Button>
  );
}

interface Props {
  readonly edgeNodeId: string;
  /** Fuso da UNIDADE do Edge, nunca o do navegador (DS §11, regra 5). */
  readonly timeZone: string;
}

/**
 * Gera o código de pareamento de um Edge já cadastrado (issue #404).
 *
 * Existe separado do cadastro porque o pareamento NÃO é evento único: o
 * código tem TTL curto e morre no primeiro uso, e o ADR-011 prevê revogação
 * pelo painel — depois da qual o agente precisa parear de novo. Sem esta
 * ação, um Edge revogado ou com código expirado só voltaria a funcionar
 * cadastrando outro, o que duplicaria o registro e perderia o histórico.
 */
export function PareaEdge({ edgeNodeId, timeZone }: Props) {
  const [estado, acao] = useActionState(gerarCodigoDePareamento, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-do-pareamento');

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="codigo-de-pareamento">
        <p>
          Código: <strong>{estado.sucesso.code}</strong>
        </p>
        <p>
          Vale até <TenantDateTime iso={estado.sucesso.expiresAt} timeZone={timeZone} />. Aparece
          uma única vez — copie para <code>EDGE_PAIRING_CODE</code> no PC da recepção.
        </p>
        <form action={acao}>
          <input type="hidden" name="edgeNodeId" value={edgeNodeId} />
          <Botao jaGerado />
        </form>
      </div>
    );
  }

  return (
    <form action={acao}>
      <input type="hidden" name="edgeNodeId" value={edgeNodeId} />
      <Botao jaGerado={false} />
    </form>
  );
}
