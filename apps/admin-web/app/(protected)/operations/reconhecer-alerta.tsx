'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@arenahub/ui';

import {
  reconhecerAlerta,
  type EstadoDoReconhecimento,
} from '../../actions/operations';

const ESTADO_INICIAL: EstadoDoReconhecimento = {};

function Botao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending} data-testid="reconhecer">
      {pending ? 'Reconhecendo…' : 'Reconhecer'}
    </Button>
  );
}

/**
 * Reconhecimento de um alerta.
 *
 * A ÚNICA parte cliente desta tela. O resto é Server Component: o painel lê
 * dado no servidor e chega pronto, sem o navegador buscar nada. Uma tela
 * operacional que depende de JavaScript para mostrar que a catraca parou
 * falharia exatamente quando a rede está ruim — que é quando ela mais
 * precisa funcionar.
 */
export function ReconhecerAlerta({ alertaId }: { alertaId: string }) {
  const [estado, acao] = useActionState(reconhecerAlerta, ESTADO_INICIAL);

  return (
    <form action={acao}>
      <input type="hidden" name="alertaId" value={alertaId} />
      <Botao />
      {estado.erro ? (
        <span role="alert" data-testid="erro-do-reconhecimento">
          {estado.erro}
        </span>
      ) : null}
    </form>
  );
}
