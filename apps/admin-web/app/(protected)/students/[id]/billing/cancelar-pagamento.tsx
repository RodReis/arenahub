'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, Icon, useToast } from '@arenahub/ui';

import { cancelarPagamento } from '../../../../actions/billing';
import estilos from './cancelar-pagamento.module.css';

interface Props {
  readonly paymentId: string;
  /** "nov/26, Dinheiro" -- o que a recepcao reconhece como SEU lancamento. */
  readonly resumo: string;
}

/**
 * Cancelar um pagamento manual lancado por engano -- F85, decisao do PI em
 * 05/10/2026.
 *
 * O `ConfirmDialog` ja entrega o que a regra pede: resumo do efeito, motivo
 * OBRIGATORIO e verbo real no botao ("Cancelar pagamento", nunca "OK"). O
 * resumo diz o que ninguem adivinharia da palavra: a cobranca volta a ficar em
 * aberto, entao o aluno volta a dever o mes ate alguem lancar o certo.
 *
 * Resultado em TOAST, nunca `Alert` (CLAUDE.md). Sucesso recarrega a pagina:
 * o pagamento some da coluna e a faixa de meses volta a oferecer o mes.
 */
export function CancelarPagamento({ paymentId, resumo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const confirmar = (motivo: string): void => {
    setAberto(false);

    iniciar(async () => {
      const resultado = await cancelarPagamento(paymentId, motivo);

      if (resultado.erro !== undefined) {
        show('error', resultado.erro, 'erro-ao-cancelar-pagamento');

        return;
      }

      show(
        'info',
        'Pagamento cancelado. A cobrança voltou a ficar em aberto.',
        'pagamento-cancelado',
      );
      router.refresh();
    });
  };

  return (
    <span className={estilos['acao']}>
      <Button
        variant="ghost"
        type="button"
        disabled={pendente}
        onClick={() => setAberto(true)}
        data-testid="cancelar-pagamento"
      >
        <Icon name="x-circle" />
        Cancelar
      </Button>

      <ConfirmDialog
        open={aberto}
        verb="Cancelar pagamento"
        summary={`Cancelar o recebimento de ${resumo}. A cobrança volta a ficar em aberto e o aluno volta a dever o mês até alguém lançar o pagamento certo. O registro do cancelamento fica na auditoria.`}
        onConfirm={confirmar}
        onCancel={() => setAberto(false)}
        testId="confirmar-cancelamento"
      />
    </span>
  );
}
