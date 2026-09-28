'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { EmptyState, Field, Money, SensitiveAction, useToast, useToastDeErro } from '@arenahub/ui';

import {
  abrirCobranca,
  emitirReciboDaInvoice,
  registrarPagamentoNoBalcao,
  type EstadoDaInvoice,
  type EstadoDoPagamento,
} from '../../../../actions/billing';
import { SeletorDeForma, type FormaDePagamento } from './seletor-de-forma';

interface InvoiceEmAberto {
  id: string;
  number: number;
  totalMinor: number;
  currency: string;
}

interface Cobrando {
  invoice: InvoiceEmAberto;
  forma: FormaDePagamento;
}

interface Props {
  readonly subscriptionId: string | null;
  readonly invoicesEmAberto: readonly InvoiceEmAberto[];
}

const ESTADO_DA_INVOICE: EstadoDaInvoice = {};
const ESTADO_DO_PAGAMENTO: EstadoDoPagamento = {};

/** Texto do resumo de confirmacao, por forma -- SensitiveAction le em voz alta o que vai acontecer. */
const RESUMO_POR_FORMA: Record<FormaDePagamento, string> = {
  DINHEIRO: 'em dinheiro',
  PIX: 'via PIX pela maquininha',
  DEBITO: 'no débito pela maquininha',
  CREDITO: 'no crédito pela maquininha',
};

function BotaoDeGerar() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} data-testid="gerar-cobranca">
      {pending ? 'Gerando…' : 'Gerar cobrança do mês'}
    </button>
  );
}

/**
 * Cobrança e recebimento no balcão — F12, Slice 2.1. Forma de pagamento
 * antes do valor — F53, Task 10. Maquininha física, baixa manual —
 * F-painel-financeiro, decisão do PI em 28/09/2026.
 *
 * A CENA REAL: a academia tem maquininha física (ainda não integrada ao
 * sistema). A recepcionista recebe por ela — dinheiro, PIX, débito ou
 * crédito — e dá baixa manual aqui. Os quatro caminhos do `SeletorDeForma`
 * convergem no MESMO fluxo: valor → `SensitiveAction` com motivo
 * obrigatório → recibo. Só o canal registrado (`receivedVia`, ver
 * `billing.repository.ts`) muda entre eles — `method` continua sempre
 * `MANUAL`.
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
export function PainelDeCobranca({ subscriptionId, invoicesEmAberto }: Props) {
  const [estadoDaInvoice, gerar] = useActionState(abrirCobranca, ESTADO_DA_INVOICE);
  const [estadoDoPagamento, receber] = useActionState(
    registrarPagamentoNoBalcao,
    ESTADO_DO_PAGAMENTO,
  );
  const [cobrando, setCobrando] = useState<Cobrando | null>(null);
  const [valor, setValor] = useState('');
  const idDoValor = useId();
  const { show } = useToast();

  const [reciboDoBalcao, setReciboDoBalcao] = useState<{ numero: number } | null>(null);
  const invoiceDoReciboPedidoRef = useRef<string | null>(null);

  // Os erros da tela viram toast -- CLAUDE.md: "sempre usar Toast para:
  // Info, Warn e error". Cada acao anuncia a propria falha.
  useToastDeErro(estadoDaInvoice.erro, 'error', 'erro-ao-gerar');
  useToastDeErro(estadoDoPagamento.erro, 'error', 'erro-ao-receber');

  // Recibo em toda confirmacao -- os quatro canais fecham pelo mesmo fluxo.
  useEffect(() => {
    const invoiceId = estadoDoPagamento.sucesso?.invoiceId;

    if (!invoiceId || invoiceDoReciboPedidoRef.current === invoiceId) return;

    invoiceDoReciboPedidoRef.current = invoiceId;

    /*
     * A FALHA DO RECIBO PRECISA APARECER.
     *
     * O dinheiro ja entrou quando chegamos aqui -- o pagamento foi registrado
     * e a fatura esta paga. Se a emissao do recibo falhar em silencio, a
     * recepcionista fica com o dinheiro na mao, sem recibo e sem nada na tela
     * dizendo o que aconteceu; ela reemitiria clicando de novo, ou entregaria
     * o troco sem comprovante.
     *
     * `catch` alem do `sucesso`: a action devolve erro de dominio no
     * resultado, mas queda de rede rejeita a promessa, e sem tratar as duas
     * sobra `unhandled rejection` no lugar de aviso.
     */
    void emitirReciboDaInvoice(invoiceId)
      .then((resultado) => {
        if (resultado.sucesso) {
          setReciboDoBalcao({ numero: resultado.sucesso.numero });
          return;
        }

        show('error', 'Pagamento registrado, mas o recibo nao foi emitido. Tente reemitir.');
      })
      .catch(() => {
        show('error', 'Pagamento registrado, mas o recibo nao foi emitido. Tente reemitir.');
      });
  }, [estadoDoPagamento.sucesso, show]);

  const confirmarRecebimento = (motivo: string): void => {
    if (!cobrando) return;

    const dados = new FormData();
    dados.set('invoiceId', cobrando.invoice.id);
    dados.set('valor', valor);
    dados.set('reason', motivo);
    dados.set('receivedVia', cobrando.forma);

    receber(dados);
    setCobrando(null);
    setValor('');
  };

  const escolherForma = (invoice: InvoiceEmAberto, forma: FormaDePagamento): void => {
    setCobrando({ invoice, forma });
    /*
     * Pré-preenche com o valor integral: é o caso comum, e pagamento
     * parcial é recusado pelo servidor de qualquer forma (ADR-027,
     * resposta 1). Digitar do zero só criaria chance de errar centavo.
     */
    setValor((invoice.totalMinor / 100).toFixed(2).replace('.', ','));
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

      {reciboDoBalcao ? (
        <p role="status" data-testid="recibo-emitido-em-especie">
          Recibo nº {reciboDoBalcao.numero} emitido.
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
                <SeletorDeForma onEscolher={(forma) => escolherForma(invoice, forma)} />
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
            summary={`Confirma o recebimento ${RESUMO_POR_FORMA[cobrando.forma]} da cobrança nº ${String(cobrando.invoice.number)}. A cobrança será marcada como paga e o registro fica ligado ao seu usuário na auditoria.`}
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
