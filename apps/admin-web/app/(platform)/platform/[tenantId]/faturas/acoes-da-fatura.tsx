'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import { registrarPagamentoDaFatura, type EstadoDaFatura } from '../../../../actions/faturas';

const ESTADO_INICIAL: EstadoDaFatura = {};

interface Props {
  readonly faturaId: string;
  readonly tenantId: string;
  readonly status: 'OPEN' | 'PAID' | 'OVERDUE';
}

function BotaoDeRegistrar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="registrar-pagamento">
      {pending ? 'Registrando…' : 'Registrar pagamento'}
    </Button>
  );
}

/**
 * O que se pode fazer com uma fatura, conforme o estado dela.
 *
 * Fatura PAGA não mostra botão nenhum — e não um botão apagado: um "Registrar
 * pagamento" desabilitado numa fatura já paga convida ao clique e não explica
 * nada. Mesmo critério de `AcoesDoContrato`.
 *
 * VENCIDA continua aceitando: a academia paga atrasado, e é justamente o
 * pagamento que faz a carência parar de correr (F65).
 */
export function AcoesDaFatura({ faturaId, tenantId, status }: Props) {
  const [estado, acao] = useActionState(registrarPagamentoDaFatura, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-ao-registrar-pagamento');

  if (status === 'PAID') return null;

  return (
    <form action={acao}>
      <input type="hidden" name="id" value={faturaId} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <BotaoDeRegistrar />
    </form>
  );
}
