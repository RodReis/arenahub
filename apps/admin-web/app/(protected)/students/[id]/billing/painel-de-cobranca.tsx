'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { EmptyState, Field, Money, SensitiveAction, useToast, useToastDeErro } from '@arenahub/ui';

import {
  abrirCobranca,
  registrarPagamentoNoBalcao,
  type EstadoDaInvoice,
  type EstadoDoPagamento,
} from '../../../../actions/billing';

interface InvoiceEmAberto {
  id: string;
  number: number;
  totalMinor: number;
  currency: string;
}

interface Props {
  readonly subscriptionId: string | null;
  readonly invoicesEmAberto: readonly InvoiceEmAberto[];
}

const ESTADO_DA_INVOICE: EstadoDaInvoice = {};
const ESTADO_DO_PAGAMENTO: EstadoDoPagamento = {};

function BotaoDeGerar() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} data-testid="gerar-cobranca">
      {pending ? 'Gerando…' : 'Gerar cobrança do mês'}
    </button>
  );
}

/**
 * Cobrança e recebimento no balcão — F12, Slice 2.1.
 *
 * Duas ações, deliberadamente separadas:
 *
 *   1. GERAR a cobrança do mês — idempotente no servidor (INV-066), então
 *      clique duplo não cobra duas vezes. Por isso o botão não precisa de
 *      confirmação: repetir é seguro.
 *   2. RECEBER dinheiro no balcão — passa por `SensitiveAction`, com motivo
 *      obrigatório. Não porque possa duplicar, mas porque reconhecer dinheiro
 *      sem provedor é o ato que a auditoria vai ler depois. Com a dupla
 *      permissão fora do MVP 2 (ADR-027), o motivo é parte do único controle
 *      que restou.
 */
export function PainelDeCobranca({ subscriptionId, invoicesEmAberto }: Props) {
  const [estadoDaInvoice, gerar] = useActionState(abrirCobranca, ESTADO_DA_INVOICE);
  const [estadoDoPagamento, receber] = useActionState(
    registrarPagamentoNoBalcao,
    ESTADO_DO_PAGAMENTO,
  );
  const [cobrando, setCobrando] = useState<InvoiceEmAberto | null>(null);
  const [valor, setValor] = useState('');
  const idDoValor = useId();
  const { show } = useToast();

  // Os dois erros da tela viram toast -- CLAUDE.md: "sempre usar Toast para:
  // Info, Warn e error". Gerar cobranca e receber pagamento sao acoes
  // distintas, e cada uma anuncia a propria falha.
  useToastDeErro(estadoDaInvoice.erro, 'error', 'erro-ao-gerar');
  useToastDeErro(estadoDoPagamento.erro, 'error', 'erro-ao-receber');

  const confirmarRecebimento = (motivo: string): void => {
    if (!cobrando) return;

    const dados = new FormData();
    dados.set('invoiceId', cobrando.id);
    dados.set('valor', valor);
    dados.set('reason', motivo);

    receber(dados);
    setCobrando(null);
    setValor('');
  };

  return (
    <section aria-labelledby="titulo-cobranca">
      <h2 id="titulo-cobranca">Cobrança</h2>

      {/*
        Sobrepagamento vira crédito do aluno (ADR-027, resposta 4). Sem este
        aviso, o troco "some" da perspectiva de quem está no balcão — a pessoa
        pagou mais e a tela só diria "paga".
      */}
      {estadoDoPagamento.sucesso?.creditoGerado ? (
        <p role="status" data-testid="credito-gerado">
          Pagamento registrado. A diferença virou crédito do aluno e abate a próxima cobrança.
        </p>
      ) : null}

      {subscriptionId === null ? (
        <EmptyState
          testId="sem-assinatura-ativa"
          title="Este aluno não tem assinatura ativa."
          hint="A cobrança nasce da assinatura — atribua um plano antes de gerar."
        />
      ) : (
        <form action={gerar}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <BotaoDeGerar />
          {/*
            A idempotência é do servidor, mas quem opera precisa saber disso
            ANTES de clicar de novo — senão evita o clique com medo de cobrar
            duas vezes, e liga para o suporte.
          */}
          <small>Gerar de novo no mesmo mês não duplica: devolve a mesma cobrança.</small>
        </form>
      )}

      {invoicesEmAberto.length > 0 ? (
        <section aria-labelledby="titulo-receber">
          <h3 id="titulo-receber">Receber no balcão</h3>

          <ul>
            {invoicesEmAberto.map((invoice) => (
              <li key={invoice.id}>
                Cobrança nº {invoice.number} —{' '}
                <Money cents={invoice.totalMinor} currency={invoice.currency} />
                <button
                  type="button"
                  data-testid={`receber-${invoice.id}`}
                  onClick={() => {
                    setCobrando(invoice);
                    /*
                     * Pré-preenche com o valor integral: é o caso comum, e
                     * pagamento parcial é recusado pelo servidor de qualquer
                     * forma (ADR-027, resposta 1). Digitar do zero só criaria
                     * chance de errar centavo.
                     */
                    setValor((invoice.totalMinor / 100).toFixed(2).replace('.', ','));
                  }}
                >
                  Registrar recebimento
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cobrando ? (
        <>
          <Field
            id={idDoValor}
            label="Valor recebido"
            unit="R$"
            name="valor-recebido"
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
            hint="Em reais, com até duas casas — por exemplo 150,00."
            inputMode="decimal"
          />
          <SensitiveAction
            verb="Registrar recebimento"
            summary={`Confirma o recebimento em dinheiro ou transferência da cobrança nº ${String(cobrando.number)}. A cobrança será marcada como paga e o registro fica ligado ao seu usuário na auditoria.`}
            onConfirm={(motivo) => {
              confirmarRecebimento(motivo);
              show('info', 'Registrando o recebimento…');
            }}
            onCancel={() => {
              setCobrando(null);
              setValor('');
            }}
          />
        </>
      ) : null}
    </section>
  );
}
