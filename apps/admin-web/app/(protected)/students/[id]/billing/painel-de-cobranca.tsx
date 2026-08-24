'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { EmptyState, Field, Money, SensitiveAction, useToast, useToastDeErro } from '@arenahub/ui';

import {
  abrirCobranca,
  emitirReciboDaInvoice,
  iniciarCheckoutDeCartao,
  iniciarCobrancaPix,
  registrarPagamentoNoBalcao,
  type EstadoDaCobrancaPorQr,
  type EstadoDaInvoice,
  type EstadoDoPagamento,
} from '../../../../actions/billing';
import { CobrancaPorQr } from './cobranca-por-qr';
import { SeletorDeForma, type DadoFaltante, type FormaDePagamento } from './seletor-de-forma';

interface InvoiceEmAberto {
  id: string;
  number: number;
  totalMinor: number;
  currency: string;
}

interface Props {
  readonly studentId: string;
  readonly subscriptionId: string | null;
  readonly invoicesEmAberto: readonly InvoiceEmAberto[];
  readonly faltandoParaCartao: readonly DadoFaltante[];
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
 * Cobrança e recebimento no balcão — F12, Slice 2.1. Forma de pagamento
 * antes do valor — F53, Task 10.
 *
 * A CENA REAL: a recepcionista tem a pessoa no balcão escolhendo como paga.
 * Por isso o `SeletorDeForma` vem primeiro por cobrança em aberto, e só
 * depois de escolhido é que o caminho específico aparece:
 *
 *   1. DINHEIRO — entra no fluxo que já existia (INTOCADO): valor →
 *      `SensitiveAction` com motivo obrigatório. Não porque possa duplicar,
 *      mas porque reconhecer dinheiro sem provedor é o ato que a auditoria
 *      vai ler depois. Com a dupla permissão fora do MVP 2 (ADR-027), o
 *      motivo é parte do único controle que restou.
 *   2. PIX / CARTÃO — chamam as novas Server Actions e entregam QR/link ao
 *      componente da Task 11 (`CobrancaPorQr`, ainda não criado nesta task).
 *
 * GERAR a cobrança do mês continua separada, idempotente no servidor
 * (INV-066): clique duplo não cobra duas vezes, por isso sem confirmação.
 */
export function PainelDeCobranca({
  studentId,
  subscriptionId,
  invoicesEmAberto,
  faltandoParaCartao,
}: Props) {
  const [estadoDaInvoice, gerar] = useActionState(abrirCobranca, ESTADO_DA_INVOICE);
  const [estadoDoPagamento, receber] = useActionState(
    registrarPagamentoNoBalcao,
    ESTADO_DO_PAGAMENTO,
  );
  const [cobrando, setCobrando] = useState<InvoiceEmAberto | null>(null);
  const [valor, setValor] = useState('');
  const idDoValor = useId();
  const { show } = useToast();

  const [cobrancaPorQr, setCobrancaPorQr] = useState<EstadoDaCobrancaPorQr | null>(null);
  const [gerandoQr, setGerandoQr] = useState(false);

  const [reciboDoBalcao, setReciboDoBalcao] = useState<{ numero: number } | null>(null);
  const invoiceDoReciboPedidoRef = useRef<string | null>(null);

  // Os erros da tela viram toast -- CLAUDE.md: "sempre usar Toast para:
  // Info, Warn e error". Cada acao anuncia a propria falha.
  useToastDeErro(estadoDaInvoice.erro, 'error', 'erro-ao-gerar');
  useToastDeErro(estadoDoPagamento.erro, 'error', 'erro-ao-receber');
  useToastDeErro(cobrancaPorQr?.erro, 'error', 'erro-ao-gerar-qr');

  /*
   * Recibo em toda confirmacao, nos tres caminhos (SPEC-053 item 5) -- este
   * efeito cobre o DINHEIRO. PIX e cartao emitem dentro de `CobrancaPorQr`,
   * quando o proprio polling ve a invoice virar PAID.
   */
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
    dados.set('invoiceId', cobrando.id);
    dados.set('valor', valor);
    dados.set('reason', motivo);

    receber(dados);
    setCobrando(null);
    setValor('');
  };

  const escolherForma = (invoice: InvoiceEmAberto, forma: FormaDePagamento): void => {
    setCobrancaPorQr(null);

    if (forma === 'DINHEIRO') {
      setCobrando(invoice);
      /*
       * Pré-preenche com o valor integral: é o caso comum, e pagamento
       * parcial é recusado pelo servidor de qualquer forma (ADR-027,
       * resposta 1). Digitar do zero só criaria chance de errar centavo.
       */
      setValor((invoice.totalMinor / 100).toFixed(2).replace('.', ','));
      return;
    }

    setCobrando(null);
    setGerandoQr(true);

    const gerar = forma === 'PIX' ? iniciarCobrancaPix : iniciarCheckoutDeCartao;

    void gerar(invoice.id).then((resultado) => {
      setGerandoQr(false);
      setCobrancaPorQr(resultado);
    });
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
                <SeletorDeForma
                  studentId={studentId}
                  faltandoParaCartao={faltandoParaCartao}
                  onEscolher={(forma) => escolherForma(invoice, forma)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {gerandoQr ? (
        <p role="status" data-testid="gerando-qr">
          Gerando cobrança…
        </p>
      ) : null}

      {/*
        QR, copia-e-cola, checkoutUrl e polling controlado -- Task 11.
        `key={paymentAttemptId}` remonta o componente a cada nova cobranca,
        para o laco de polling da tentativa anterior nao sobreviver a uma
        cobranca gerada de novo (aluno cancelou e pediu outro QR).
      */}
      {cobrancaPorQr?.sucesso ? (
        <section aria-labelledby="titulo-cobranca-por-qr">
          <h3 id="titulo-cobranca-por-qr">Aguardando pagamento</h3>
          <CobrancaPorQr
            key={cobrancaPorQr.sucesso.paymentAttemptId}
            paymentAttemptId={cobrancaPorQr.sucesso.paymentAttemptId}
            invoiceId={cobrancaPorQr.sucesso.invoiceId}
            qrCodeDataUri={cobrancaPorQr.sucesso.qrCodeDataUri}
            copiaECola={cobrancaPorQr.sucesso.copiaECola}
            checkoutUrl={cobrancaPorQr.sucesso.checkoutUrl}
            expiresAt={cobrancaPorQr.sucesso.expiresAt}
            amountMinor={cobrancaPorQr.sucesso.amountMinor}
            currency={cobrancaPorQr.sucesso.currency}
          />
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
