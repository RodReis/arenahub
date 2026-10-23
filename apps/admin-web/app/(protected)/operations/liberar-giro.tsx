'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToast, useToastDeErro } from '@arenahub/ui';

import { liberarGiro, type EstadoDoGiro } from '../../actions/access-override';

const ESTADO_INICIAL: EstadoDoGiro = {};

function Botao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="success" disabled={pending} data-testid="liberar-giro">
      {pending ? 'Liberando…' : 'Liberar giro'}
    </Button>
  );
}

/**
 * Libera UM giro da catraca, sem regra de acesso -- #660.
 *
 * Sem diálogo de confirmação de propósito: é o botão da recepção para quem
 * está parado na frente da catraca, e cada clique é um giro auditado. O
 * giro sai quando o Edge busca o comando (até `SYNC_POLL_INTERVAL_MS`), e o
 * toast diz isso para ninguém clicar de novo achando que falhou.
 */
export function LiberarGiro({ gymUnitId, deviceId }: { gymUnitId: string; deviceId: string }) {
  const [estado, acao] = useActionState(liberarGiro, ESTADO_INICIAL);
  const { show } = useToast();

  useToastDeErro(estado.erro, 'error', 'erro-ao-liberar-giro');

  useEffect(() => {
    if (estado.liberadoEm) {
      show('info', 'Giro liberado. A catraca destrava em alguns segundos.', 'giro-liberado');
    }
  }, [estado.liberadoEm, show]);

  return (
    <form action={acao}>
      <input type="hidden" name="gymUnitId" value={gymUnitId} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <Botao />
    </form>
  );
}
