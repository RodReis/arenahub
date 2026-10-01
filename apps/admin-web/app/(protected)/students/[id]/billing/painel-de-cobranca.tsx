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
 * O UNICO PRIMARIO DA TELA (DS-PAINEL §4.8).
 *
 * Era um `<button>` cru, sem classe -- renderizava como texto sublinhado
 * colado na propria nota de rodape, indistinguivel de um link. O `Button` do
 * design system traz o gradiente de acao, a altura de 36 px e o estado
 * `disabled` que o `useFormStatus` precisa mostrar durante o envio.
 *
 */
function BotaoDeGerar() {
  const { pending } = useFormStatus();

  return (
    <Button variant="solid" type="submit" disabled={pending} data-testid="gerar-cobranca">
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
    <section aria-labelledby="titulo-cobranca">
      <h2 id="titulo-cobranca">Cobrança</h2>

      {subscriptionId === null && subscriptionIdParaPagamento === null ? (
        <EmptyState
          testId="sem-assinatura-ativa"
          title="Este aluno não tem assinatura ativa."
          hint="A cobrança nasce da assinatura — atribua um plano antes de gerar."
        />
      ) : (
        <>
          {subscriptionId !== null ? (
            /*
              O botao e a nota ficam EMPILHADOS, nao lado a lado. Eram irmaos
              diretos de um `<form>` sem estilo: o `<small>` colava no rotulo do
              botao e a frase lia como parte dele ("Gerar cobranca do mesGerar de
              novo no mesmo mes nao duplica").
            */
            <form action={gerar} className={estilos['gerar']}>
              <input type="hidden" name="subscriptionId" value={subscriptionId} />
              <BotaoDeGerar />
              {/*
                A idempotência é do servidor, mas quem opera precisa saber disso
                ANTES de clicar de novo — senão evita o clique com medo de cobrar
                duas vezes, e liga para o suporte.
              */}
              <small className={estilos['nota']}>
                Gerar de novo no mesmo mês não duplica: devolve a mesma cobrança.
              </small>
            </form>
          ) : null}

          {subscriptionIdParaPagamento !== null && mesesPagaveis.length > 0 ? (
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
        </>
      )}
    </section>
  );
}
