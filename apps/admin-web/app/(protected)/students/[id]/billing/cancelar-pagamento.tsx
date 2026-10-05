'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FcCancel } from 'react-icons/fc';

import { Button, ConfirmDialog, useToast } from '@arenahub/ui';

import { cancelarPagamento } from '../../../../actions/billing';
import estilos from './cancelar-pagamento.module.css';

interface Props {
  readonly paymentId: string;
  /** "nov/26, Dinheiro" -- o que a recepcao reconhece como SEU lancamento. */
  readonly resumo: string;
}

/** Mesmo tamanho dos icones da Lista de Alunos (`acoes-do-aluno.tsx`). */
const TAMANHO = 22;

/**
 * Cancelar um pagamento manual lancado por engano -- F85, decisao do PI em
 * 05/10/2026.
 *
 * ICONE, NAO BOTAO DE TEXTO -- mesmo padrao da coluna Acao da Lista de Alunos
 * (decisao do PI, 05/10/2026; DS-PAINEL §5.3b): desenho `react-icons/fc` de
 * 22 px num alvo de 32 px, com `aria-label` e `title` dizendo a acao e QUAL
 * pagamento -- "Cancelar" repetido em cinco linhas nao diz nada a quem ouve.
 *
 * Quem decide se o icone aparece e a API (`cancellable`): so pagamento
 * adiantado ou duplicado na mesma competencia. Ausencia e a informacao certa
 * -- um icone desabilitado sugeriria que da para cancelar mes passado.
 *
 * O dialogo SO FECHA NO SUCESSO. Recusa da API (409, motivo curto) vira toast
 * com o dialogo aberto e o motivo ainda digitado -- perder o texto e o
 * caminho mais curto para alguem desistir de escrever motivo de verdade.
 */
export function CancelarPagamento({ paymentId, resumo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const confirmar = (motivo: string): void => {
    if (pendente) return;

    iniciar(async () => {
      const resultado = await cancelarPagamento(paymentId, motivo);

      if (resultado.erro !== undefined) {
        show('error', resultado.erro, 'erro-ao-cancelar-pagamento');

        return;
      }

      setAberto(false);
      show('info', `Pagamento de ${resumo} cancelado.`, 'pagamento-cancelado');
      router.refresh();
    });
  };

  return (
    <span className={estilos['acao']}>
      <Button
        variant="icon"
        type="button"
        disabled={pendente}
        onClick={() => setAberto(true)}
        aria-label={`Cancelar pagamento de ${resumo}`}
        title="Cancelar pagamento"
        data-testid="cancelar-pagamento"
      >
        <FcCancel size={TAMANHO} aria-hidden />
      </Button>

      <ConfirmDialog
        open={aberto}
        verb="Cancelar pagamento"
        summary={`Cancelar o recebimento de ${resumo}. Se era o único pagamento do mês, a cobrança volta a ficar em aberto até alguém lançar o certo. O cancelamento fica registrado na auditoria.`}
        onConfirm={confirmar}
        onCancel={() => setAberto(false)}
        testId="confirmar-cancelamento"
      />
    </span>
  );
}
