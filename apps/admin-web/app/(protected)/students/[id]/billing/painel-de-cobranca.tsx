'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Button, EmptyState, Icon, useToastDeErro } from '@arenahub/ui';

import estilos from './painel-de-cobranca.module.css';

import { abrirCobranca, type EstadoDaInvoice } from '../../../../actions/billing';
import type { MesPagavelUI } from '../../../../../src/billing/meses-pagaveis';
import { FaixaDeMeses } from './faixa-de-meses';

interface Props {
  readonly subscriptionId: string | null;
  /**
   * Assinatura para o LOTE (`FaixaDeMeses`) -- ACTIVE OU SUSPENDED
   * (`page.tsx`). Pode divergir de `subscriptionId`: um aluno SUSPENDED nao
   * tem "Gerar cobranca do mes" mas tem FaixaDeMeses, exatamente o caminho de
   * volta para ACTIVE.
   */
  readonly subscriptionIdParaPagamento: string | null;
  readonly mesesPagaveis: readonly MesPagavelUI[];
}

const ESTADO_DA_INVOICE: EstadoDaInvoice = {};

/**
 * SECUNDARIO desde 01/10/2026. O primario da tela passou a ser "Receber": o
 * lote abre a cobranca do mes sozinho, entao gerar sem receber virou o caso
 * raro -- deixar a fatura aberta para cobrar depois. Um botao cheio de
 * largura total acima do recebimento disputava o olho com a acao real.
 */
function BotaoDeGerar() {
  const { pending } = useFormStatus();

  return (
    <Button variant="outline" type="submit" disabled={pending} data-testid="gerar-cobranca">
      <Icon name="receipt" />
      {pending ? 'Gerando…' : 'Gerar cobrança do mês'}
    </Button>
  );
}

/**
 * Cobrança e recebimento no balcão — F12, Slice 2.1. Pagamento em lote —
 * F83, Task 7. Maquininha física, baixa manual — F-painel-financeiro,
 * decisão do PI em 28/09/2026.
 *
 * A CENA REAL: a academia tem maquininha física (ainda não integrada ao
 * sistema). A recepcionista recebe por ela — dinheiro, PIX, débito ou
 * crédito — e dá baixa manual aqui. `FaixaDeMeses` (F83) substituiu o
 * recebimento de UMA invoice por vez pela seleção contínua de vários meses
 * — a mesma maquininha, o mesmo canal, agora numa única operação
 * (`manual-payment-batch`).
 *
 * O CHECKOUT HOSPEDADO SAIU DESTA TELA (QR, copia-e-cola, link de
 * checkout): a maquininha física é o caminho real hoje, e o checkout nunca
 * foi integrado. `iniciarCobrancaPix`/`iniciarCheckoutDeCartao`
 * (`app/actions/billing.ts`) e `cobranca-por-qr.tsx` ficam órfãos de
 * propósito — voltam como caminho SEPARADO quando um provedor de checkout
 * hospedado for integrado de verdade (fatia futura, ver spec anterior
 * SPEC-053 §3.1 para o desenho original).
 *
 * GERAR a cobrança do mês continua separada, idempotente no servidor
 * (INV-066): clique duplo não cobra duas vezes, por isso sem confirmação.
 */
export function PainelDeCobranca({ subscriptionId, subscriptionIdParaPagamento, mesesPagaveis }: Props) {
  const [estadoDaInvoice, gerar] = useActionState(abrirCobranca, ESTADO_DA_INVOICE);
  const router = useRouter();

  // Erro de "Gerar cobrança" vira toast -- CLAUDE.md: "sempre usar Toast para:
  // Info, Warn e error". O erro do lote é tratado dentro de `FaixaDeMeses`.
  useToastDeErro(estadoDaInvoice.erro, 'error', 'erro-ao-gerar');

  return (
    <section aria-labelledby="titulo-cobranca" className={estilos['painel']}>
      <header className={estilos['cabecalho']}>
        <h2 id="titulo-cobranca">Cobrança</h2>

        {subscriptionId !== null ? (
          /*
            Gerar cobranca e idempotente no servidor (INV-066); a nota fica
            junto do botao para quem opera saber disso ANTES de clicar de novo.
          */
          <form action={gerar} className={estilos['gerar']}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <BotaoDeGerar />
            <small className={estilos['nota']}>Gerar de novo no mesmo mês não duplica.</small>
          </form>
        ) : null}
      </header>

      {subscriptionId === null && subscriptionIdParaPagamento === null ? (
        <EmptyState
          testId="sem-assinatura-ativa"
          title="Este aluno não tem assinatura ativa."
          hint="A cobrança nasce da assinatura — atribua um plano antes de gerar."
        />
      ) : subscriptionIdParaPagamento !== null && mesesPagaveis.length > 0 ? (
        <FaixaDeMeses
          // `key` muda sempre que o CONTEUDO da faixa muda (mes pago some,
          // mes novo aparece, status muda) -- forca remontar o componente
          // para que `useState(() => selecaoInicial(faixa))` rode de novo.
          // Sem isso, `router.refresh()` troca a prop mas a selecao antiga
          // (indices de ANTES do pagamento) sobrevive por cima dos dados
          // novos -- risco de cobrar mes que o aluno nao pediu.
          key={mesesPagaveis.map((m) => `${m.competencia}:${m.status}`).join('|')}
          faixa={mesesPagaveis}
          subscriptionId={subscriptionIdParaPagamento}
          onPago={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}
