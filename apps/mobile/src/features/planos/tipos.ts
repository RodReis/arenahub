/**
 * Contratos das leituras da aba Planos -- os mesmos das Slices 4.2 e 4.3.
 *
 * Moraram nos componentes `plano.tsx`, `financeiro.tsx` e `cobranca.tsx`
 * ate o App Mobile v2 juntar as tres telas numa aba so; os formatos nao
 * mudaram, so o endereco.
 */

/** A situacao do direito de acesso, como o banco a nomeia -- a tela traduz. */
export type SituacaoDoPlano = 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface DadosDoPlano {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly plano: {
    readonly situacao: SituacaoDoPlano;
    readonly inicioEm: string;
    readonly fimEm: string;
    /** NULO quando a origem nao e assinatura (cortesia, visitante, dependente). */
    readonly nome: string | null;
  } | null;
}

export interface InvoiceDoApp {
  readonly invoiceId: string;
  readonly status: string;
  readonly vencimentoEm: string;
  readonly pagoEm: string | null;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

export interface DadosDoFinanceiro {
  readonly asOf: string;
  /**
   * AUSENTE na resposta do servidor: `GET /mobile/invoices` nao manda status.
   * So quem monta o estado de falha no cliente preenche `UNAVAILABLE` -- por
   * isso a tela testa `!== 'UNAVAILABLE'`, nunca `=== 'AVAILABLE'` (o smoke do
   * App Mobile v2 pegou a aba inteira dizendo "sem conexão" com a API no ar).
   */
  readonly status?: 'AVAILABLE' | 'UNAVAILABLE';
  readonly invoices: readonly InvoiceDoApp[];
}

export interface DadosDaCobranca {
  readonly paymentAttemptId: string;
  readonly qrCodeDataUri: string;
  /** EMV do PIX; `null` no cartao. */
  readonly copiaECola: string | null;
  /** URL do checkout hospedado; `null` no PIX. */
  readonly checkoutUrl: string | null;
  readonly expiraEm: string;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}
