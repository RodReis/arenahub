'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import { emitirFatura, type EstadoDaFatura } from '../../../../actions/faturas';

const ESTADO_INICIAL: EstadoDaFatura = {};

function Botao({ jaEmitida }: { readonly jaEmitida: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || jaEmitida} data-testid="emitir-fatura">
      {pending ? 'Emitindo…' : 'Emitir agora'}
    </Button>
  );
}

/**
 * Emissão manual, fora do dia agendado — F64, ADR-052.
 *
 * O botão some do caminho quando a competência JÁ foi emitida (`jaEmitida`),
 * porque emitir de novo não faria nada: a API devolve a mesma fatura. Aqui ele
 * fica desabilitado em vez de sumir, e a diferença para `AcoesDaFatura` é
 * deliberada — o rótulo vive ao lado da prévia, que explica na mesma tela por
 * que não há o que emitir.
 */
export function EmitirFatura({
  tenantId,
  jaEmitida,
}: {
  readonly tenantId: string;
  readonly jaEmitida: boolean;
}) {
  const [estado, acao] = useActionState(emitirFatura, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-ao-emitir-fatura');

  return (
    <form action={acao}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <Botao jaEmitida={jaEmitida} />
    </form>
  );
}
