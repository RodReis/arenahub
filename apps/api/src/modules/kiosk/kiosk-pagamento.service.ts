import { Injectable, NotFoundException } from '@nestjs/common';

import { BillingRepository } from '../billing/billing.repository.js';
import { ConsultarTentativaUseCase } from '../billing/consultar-tentativa.use-case.js';
import { CriarCheckoutDeCartaoUseCase } from '../billing/criar-checkout-de-cartao.use-case.js';
import { CriarCobrancaPixUseCase } from '../billing/criar-cobranca-pix.use-case.js';
import type { AlunoDaSessao } from './kiosk-area-do-aluno.service.js';
import { MESES_DO_HISTORICO, recortarHistorico, type LinhaDoHistorico } from './domain/historico-de-pagamentos.js';

/** O QR que a tela do totem desenha -- PIX e cartao tem a MESMA forma. */
export interface CobrancaDoTotem {
  readonly paymentAttemptId: string;
  readonly forma: 'PIX' | 'CARD';
  readonly qrCodeDataUri: string;
  /** EMV do PIX; `null` no cartao, onde o que existe e a URL. */
  readonly copiaECola: string | null;
  /** URL do checkout hospedado; `null` no PIX. */
  readonly checkoutUrl: string | null;
  readonly expiraEm: string;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

/**
 * Pagamento no totem -- `M4-FR-021`, ADR-043 Decisao 4 (dois QRs).
 *
 * REUSA os casos de uso publicos de billing (regra de arquitetura no 9): o
 * totem nao escreve invoice, nao cria `PaymentAttempt` a mao e nao decide
 * nada sobre dinheiro. Ele so descobre QUAL fatura cobrar -- e essa e a
 * unica coisa que ele acrescenta.
 *
 * A INVOICE NUNCA VEM DA REQUISICAO. O totem nao aceita `invoiceId` de
 * ninguem: ele resolve a fatura em aberto mais antiga DO ALUNO DA SESSAO.
 * Aceitar o id do cliente deixaria qualquer sessao valida gerar cobranca
 * contra a fatura de outro aluno -- e o pagador seria o errado.
 */
@Injectable()
export class KioskPagamentoService {
  constructor(
    private readonly faturas: BillingRepository,
    private readonly pix: CriarCobrancaPixUseCase,
    private readonly cartao: CriarCheckoutDeCartaoUseCase,
    private readonly tentativa: ConsultarTentativaUseCase,
  ) {}

  /**
   * A fatura que o totem cobra: a MAIS ANTIGA em aberto.
   *
   * `OVERDUE` conta como aberta -- e justamente a vencida que trouxe o aluno
   * ao totem. Mesma leitura de `estadoDoPlano` na abertura da sessao; se as
   * duas divergissem, a tela diria "pendencia" e o pagamento nao acharia o
   * que cobrar.
   */
  private async faturaEmAberto(aluno: AlunoDaSessao) {
    const { invoices } = await this.faturas.listarInvoicesDoAluno(
      aluno.contexto,
      aluno.studentId,
    );

    // `listarInvoicesDoAluno` devolve `dueAt desc` -- a mais antiga em aberto
    // e a ULTIMA da lista filtrada.
    const abertas = invoices.filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE');
    const alvo = abertas.at(-1);

    if (!alvo) {
      throw new NotFoundException({ code: 'KIOSK_NO_OPEN_INVOICE' });
    }

    return alvo;
  }

  async cobrarPorPix(aluno: AlunoDaSessao, agora: Date, correlationId: string): Promise<CobrancaDoTotem> {
    const invoice = await this.faturaEmAberto(aluno);

    const cobranca = await this.pix.executar(
      aluno.contexto,
      { invoiceId: invoice.id, agora },
      correlationId,
    );

    return {
      paymentAttemptId: cobranca.paymentAttemptId,
      forma: 'PIX',
      qrCodeDataUri: cobranca.qrCodeDataUri,
      copiaECola: cobranca.copiaECola,
      checkoutUrl: null,
      expiraEm: cobranca.expiresAt.toISOString(),
      valorEmCentavos: cobranca.amountMinor,
      moeda: cobranca.currency,
    };
  }

  /**
   * Cartao: o QR abre o CHECKOUT HOSPEDADO no celular do aluno.
   *
   * O totem nao tem teclado de cartao e nao ve PAN, CVV nem token -- ele
   * continua fora do escopo PCI (ADR-043, Decisao 4, e INV-098). O que ele
   * desenha e um QR que leva a pagina do provedor.
   */
  async cobrarPorCartao(
    aluno: AlunoDaSessao,
    agora: Date,
    correlationId: string,
  ): Promise<CobrancaDoTotem> {
    const invoice = await this.faturaEmAberto(aluno);

    const checkout = await this.cartao.executar(
      aluno.contexto,
      { invoiceId: invoice.id, agora },
      correlationId,
    );

    return {
      paymentAttemptId: checkout.paymentAttemptId,
      forma: 'CARD',
      qrCodeDataUri: checkout.qrCodeDataUri,
      copiaECola: null,
      checkoutUrl: checkout.checkoutUrl,
      expiraEm: checkout.expiresAt.toISOString(),
      valorEmCentavos: checkout.amountMinor,
      moeda: checkout.currency,
    };
  }

  /**
   * O LACO da tela enquanto o QR esta aberto.
   *
   * `ConsultarTentativaUseCase` NAO toca o provedor -- le so o nosso banco,
   * onde o webhook ja escreveu. A outra consulta
   * (`ConsultarStatusDePagamentoUseCase`) chama o banco externo a cada vez, e
   * com um totem por recepcao seriam ~20 chamadas externas por minuto de QR
   * aberto. O `FakePaymentProvider` nao tem limite de taxa; Sicoob e Getnet
   * tem. O desenho errado passaria verde em dev.
   *
   * `M4-BR-001`: isto NAO confirma pagamento. Ele le o que o webhook ja
   * confirmou -- quem promove invoice, assinatura e entitlement e a cadeia do
   * MVP 2, sem bypass local nenhum.
   */
  async observar(aluno: AlunoDaSessao, paymentAttemptId: string) {
    /*
     * A TENTATIVA TEM DE SER DE UMA FATURA DO ALUNO DA SESSAO -- conferido
     * ANTES de consultar, e valendo desde a criacao da cobranca.
     *
     * `ConsultarTentativaUseCase` escopa por tenant e nao por aluno: no
     * balcao quem consulta e um operador autorizado, e escopar por aluno la
     * seria errado. No totem nao. Sem esta checagem, uma sessao valida
     * observaria a tentativa de qualquer aluno do tenant chutando UUID e
     * saberia se a fatura dele foi paga e quando.
     *
     * A amarra e pela INVOICE, nao pelo `paymentId`: `paymentId` so existe
     * depois que o webhook confirma, e ate la a checagem nao filtraria nada
     * -- que e exatamente a janela em que o QR fica aberto e a tela consulta.
     */
    const daSessao = await this.faturas.buscarTentativaDoAluno(
      aluno.contexto,
      aluno.studentId,
      paymentAttemptId,
    );

    if (!daSessao) {
      throw new NotFoundException({ code: 'KIOSK_PAYMENT_ATTEMPT_NOT_FOUND' });
    }

    const observada = await this.tentativa.executar(aluno.contexto, paymentAttemptId);

    return {
      status: observada.status,
      statusDaFatura: observada.invoiceStatus,
      pagoEm: observada.paidAt?.toISOString() ?? null,
    };
  }

  /** Historico do §5.7 -- os ultimos meses, fatura em aberto no topo. */
  async historico(aluno: AlunoDaSessao, agora: Date): Promise<readonly LinhaDoHistorico[]> {
    const { invoices } = await this.faturas.listarInvoicesDoAluno(
      aluno.contexto,
      aluno.studentId,
    );

    return recortarHistorico(invoices, agora, MESES_DO_HISTORICO);
  }
}
