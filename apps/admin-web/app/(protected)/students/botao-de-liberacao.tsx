'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { AcoesDaLinha, Button, useToastDeErro } from '@arenahub/ui';

import {
  liberarFinanceiramente,
  type EstadoDaLiberacaoFinanceira,
} from '../../actions/students';

const ESTADO_INICIAL: EstadoDaLiberacaoFinanceira = {};

interface Props {
  studentId: string;
}

/**
 * Liberação financeira de 1 clique — issue #118.
 *
 * SEM CONFIRMAÇÃO EM DOIS PASSOS de propósito: diferente do override de
 * catraca (F9), esta ação não abre nada fisicamente e expira sozinha em 3
 * dias (`DIAS_PADRAO_DE_LIBERACAO`). O pedido do PI foi explícito — "um
 * clique só, sem formulário" — para o caso comum (tolerância de pagamento),
 * com o registro de auditoria (`reason`, `actorId`) gravado do lado do
 * servidor mesmo sem a recepção digitar nada.
 */
export function BotaoDeLiberacao({ studentId }: Props) {
  const [estado, acao] = useActionState(liberarFinanceiramente, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', `erro-liberacao-${studentId}`);
  useToastDeErro(
    estado.sucesso ? `Liberado por ${diasAteExpirar(estado.sucesso.expiresAt)} dia(s).` : undefined,
    'info',
    `sucesso-liberacao-${studentId}`,
  );

  return (
    <AcoesDaLinha>
      <form action={acao}>
        <input type="hidden" name="studentId" value={studentId} />
        <BotaoInterno studentId={studentId} />
      </form>
    </AcoesDaLinha>
  );
}

function BotaoInterno({ studentId }: Props) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="solid" disabled={pending} data-testid={`liberar-${studentId}`}>
      {pending ? 'Liberando…' : 'Liberar'}
    </Button>
  );
}

/**
 * Diferença em dias até `iso`, arredondada para cima.
 *
 * NÃO É FORMATAÇÃO DE DATA -- é aritmética entre dois instantes, por isso
 * fica fora de `TenantDateTime` (regra 5 do DS §11 proíbe `Intl.DateTimeFormat`
 * e `toLocale*` soltos, não subtração de milissegundos). O toast só precisa
 * dizer "por quanto tempo", não em que dia da semana a liberação acaba.
 */
function diasAteExpirar(iso: string): number {
  const diferencaMs = new Date(iso).getTime() - Date.now();

  return Math.max(1, Math.ceil(diferencaMs / (24 * 60 * 60 * 1000)));
}
