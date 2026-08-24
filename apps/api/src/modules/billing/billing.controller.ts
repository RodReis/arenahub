import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  BillingRepository,
  type InvoiceComItens,
  type InvoiceComTimeline,
} from './billing.repository.js';
import { ConsultarStatusDePagamentoUseCase } from './consultar-status-de-pagamento.use-case.js';
import { ConsultarTentativaUseCase } from './consultar-tentativa.use-case.js';
import { ListarInvoicesUseCase, TAMANHO_MAXIMO_DA_PAGINA } from './listar-invoices.use-case.js';
import { CriarCobrancaPixUseCase } from './criar-cobranca-pix.use-case.js';
import { AplicarInadimplenciaUseCase } from './aplicar-inadimplencia.use-case.js';
import { CancelarRecorrenciaUseCase } from './cancelar-recorrencia.use-case.js';
import { ConsultarInadimplenciaUseCase } from './consultar-inadimplencia.use-case.js';
import { LiberacaoFinanceiraUseCase } from './liberacao-financeira.use-case.js';
import { CobrarAssinaturaNoCartaoUseCase } from './cobrar-assinatura-no-cartao.use-case.js';
import { CriarCheckoutDeCartaoUseCase } from './criar-checkout-de-cartao.use-case.js';
import { RegistrarMetodoDePagamentoUseCase } from './registrar-metodo-de-pagamento.use-case.js';

const esquemaDeAbertura = z
  .object({
    subscriptionId: z.uuid(),
    /**
     * Data de referencia do ciclo. Normalizada para o primeiro dia do mes
     * pelo dominio -- e o que da a unicidade de INV-066.
     *
     * Entra por parametro em vez de `new Date()` no servidor porque o ciclo
     * precisa ser reproduzivel: reprocessar agosto em setembro nao pode
     * abrir a invoice de setembro.
     */
    emQue: z.iso.datetime(),
  })
  .strict();

/**
 * Metodo de pagamento tokenizado. `MVP-02` 7, Slice 2.3.
 *
 * `.strict()` NAO E DETALHE AQUI: e o que faz uma requisicao com
 * `cardNumber` ser RECUSADA no boundary em vez de ignorada em silencio. Se um
 * front mal escrito mandar o cartao junto, a resposta e 400 -- e nao um 201
 * que esconde o PAN tendo chegado ao servidor (INV-098).
 */
const esquemaDeMetodoTokenizado = z
  .object({
    studentId: z.uuid(),
    /** Token do cofre do provedor. NUNCA o numero do cartao. */
    externalTokenId: z.string().min(8).max(255),
    brand: z.string().min(1).max(40).optional(),
    /** Exatamente 4 digitos -- e o maximo que a bandeira permite exibir. */
    last4: z.string().regex(/^[0-9]{4}$/).optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().min(2020).max(2100).optional(),
    tornarPadrao: z.boolean().optional(),
  })
  .strict();

/**
 * Liberacao financeira excepcional. Slice 2.4.
 *
 * `reason` obrigatoria e com tamanho minimo: liberar acesso de quem deve e ato
 * excepcional, e sem motivo a auditoria nao explica nada depois -- mesmo
 * criterio do pagamento manual (ADR-027).
 */
const esquemaDeLiberacao = z
  .object({
    studentId: z.uuid(),
    reason: z.string().min(3).max(300),
    dias: z.number().int().min(1).max(30).optional(),
  })
  .strict();

/**
 * Lista transversal de faturas do tenant. F53, task 6.
 *
 * `status` e `z.enum` com os seis valores REAIS de `InvoiceStatus`
 * (`packages/database/prisma/schema.prisma`) -- nao string livre. Sem o
 * enum, `?status=xyz` nao vira 400: a query roda, o Prisma nao acha nada, e
 * o cliente le `total: 0` como "tenant sem fatura" quando a verdade e
 * "status inexistente". Erro de digitacao virando resposta vazia em
 * silencio e pior que o 400.
 *
 * `tamanho` tem teto (`TAMANHO_MAXIMO_DA_PAGINA`) no proprio schema: recusar
 * no boundary evita que a validacao dependa do caso de uso lembrar de
 * cortar.
 */
const esquemaDeListagem = z
  .object({
    status: z.enum(['DRAFT', 'OPEN', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED']).optional(),
    vencendoDe: z.iso.datetime().optional(),
    vencendoAte: z.iso.datetime().optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    tamanho: z.coerce.number().int().min(1).max(TAMANHO_MAXIMO_DA_PAGINA).default(20),
  })
  .strict();

const esquemaDePagamentoManual = z
  .object({
    /**
     * Centavos, inteiro. INV-065 -- o schema recusa fracionario ANTES de
     * chegar ao dominio, que recusa de novo. Duas barreiras porque valor
     * vindo de fora e a entrada classica de float em dinheiro.
     */
    amountMinor: z.number().int().min(0),
    paidAt: z.iso.datetime(),
    /**
     * Razao obrigatoria: com a dupla permissao fora do MVP 2, a trilha e o
     * unico controle que sobrou. Trilha sem motivo nao explica nada depois
     * (ADR-027, consequencia 3).
     */
    reason: z.string().min(3).max(300),
  })
  .strict();

interface InvoiceItemDto {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  totalMinor: number;
}

interface PagamentoDto {
  id: string;
  method: string;
  status: string;
  amountMinor: number;
  paidAt: string | null;
  recognizedByUserId: string | null;
}

interface InvoiceDto {
  id: string;
  number: number;
  status: string;
  currency: string;
  billingPeriod: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  dueAt: string;
  blockAt: string | null;
  paidAt: string | null;
  items: InvoiceItemDto[];
  payments: PagamentoDto[];
}

/**
 * Resposta de `GET /students/:id/invoices` -- fuso da UNIDADE DE ORIGEM do
 * aluno (INV-144, ADR-019) junto das faturas. F53, task 7: sem o fuso aqui,
 * a tela caia de volta num valor fixo em codigo, que diverge do fuso que o
 * job de vencimento usa.
 */
interface InvoicesDoAlunoDto {
  timezone: string;
  invoices: InvoiceDto[];
}

/** Linha da lista transversal -- resumo, sem itens nem pagamentos. F53. */
interface InvoiceDaListaDto {
  id: string;
  number: number;
  status: string;
  currency: string;
  billingPeriod: string;
  totalMinor: number;
  dueAt: string;
  paidAt: string | null;
  studentId: string;
}

interface PaginaDeInvoicesDto {
  itens: InvoiceDaListaDto[];
  total: number;
  pagina: number;
  tamanho: number;
}

/** Cobranca PIX pronta para o aluno pagar. `MVP-02` 7, Slice 2.2. */
interface CobrancaPixDto {
  paymentAttemptId: string;
  externalPaymentId: string;
  copiaECola: string;
  qrCodeDataUri: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
}

/** Estado do pagamento aqui e no provedor. `MVP-02` 13. */
interface StatusDePagamentoDto {
  paymentAttemptId: string;
  invoiceId: string;
  externalPaymentId: string;
  statusLocal: string;
  statusNoProvedor: string;
  divergente: boolean;
  occurredAt: string;
}

/** Leitura barata da tentativa, para o laco de polling do balcao. F53. */
interface TentativaObservadaDto {
  paymentAttemptId: string;
  status: string;
  invoiceStatus: string;
  paidAt: string | null;
  receiptId: string | null;
  /** O pagamento gerado, para EMITIR o recibo quando `receiptId` e nulo. */
  paymentId: string | null;
}

interface MetodoDePagamentoDto {
  id: string;
  provider: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}

interface CobrancaNoCartaoDto {
  paymentAttemptId: string;
  externalSubscriptionId: string;
  amountMinor: number;
  currency: string;
}

/** Checkout hospedado de cartao pronto para o aluno pagar. F53, task 16. */
interface CheckoutDeCartaoDto {
  paymentAttemptId: string;
  externalPaymentId: string;
  checkoutUrl: string;
  qrCodeDataUri: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
}

interface RecorrenciaCanceladaDto {
  subscriptionId: string;
  canceladasNoProvedor: number;
}

interface PainelDeInadimplenciaDto {
  resumo: {
    emAtrasoMinor: number;
    faturasVencidas: number;
    bloqueados: number;
    taxaDeInadimplencia: number | null;
  };
  faixas: { rotulo: string; minorTotal: number; quantidade: number }[];
  linhas: {
    invoiceId: string;
    invoiceNumber: number;
    studentId: string;
    studentName: string;
    amountMinor: number;
    currency: string;
    dueAt: string;
    diasEmAtraso: number;
    situacao: string;
    telefone: string | null;
    liberadoAte: string | null;
    fusoDaUnidade: string;
  }[];
}

interface ResultadoDaInadimplenciaDto {
  invoicesVencidas: number;
  assinaturasEmAtraso: number;
  direitosSuspensos: number;
}

interface LiberacaoDto {
  id: string;
  studentId: string;
  expiresAt: string;
}

@Controller('api/v1')
export class BillingController {
  constructor(
    private readonly billing: BillingRepository,
    private readonly cobrancaPix: CriarCobrancaPixUseCase,
    private readonly statusDePagamento: ConsultarStatusDePagamentoUseCase,
    private readonly tentativa: ConsultarTentativaUseCase,
    private readonly listagem: ListarInvoicesUseCase,
    private readonly metodoDePagamento: RegistrarMetodoDePagamentoUseCase,
    private readonly cobrancaNoCartao: CobrarAssinaturaNoCartaoUseCase,
    private readonly checkoutDeCartao: CriarCheckoutDeCartaoUseCase,
    private readonly cancelamentoDeRecorrencia: CancelarRecorrenciaUseCase,
    private readonly inadimplencia: ConsultarInadimplenciaUseCase,
    private readonly aplicarInadimplencia: AplicarInadimplenciaUseCase,
    private readonly liberacao: LiberacaoFinanceiraUseCase,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Abre a invoice do periodo a partir da assinatura.
   *
   * IDEMPOTENTE: chamar duas vezes no mesmo periodo devolve a MESMA
   * invoice, com o mesmo numero. Clique duplo no botao nao cobra o aluno
   * duas vezes.
   */
  @Post('invoices')
  @RequirePermissions('billing.manage')
  async abrirInvoice(@Body() corpo: unknown): Promise<InvoiceDto> {
    const dados = esquemaDeAbertura.parse(corpo);

    const invoice = await this.billing.abrirInvoiceDoPeriodo(this.contexto.require(), {
      subscriptionId: dados.subscriptionId,
      emQue: new Date(dados.emQue),
    });

    const completa = await this.billing.timelineDaInvoice(this.contexto.require(), invoice.id);

    return this.paraDto(completa!);
  }

  /**
   * Registra pagamento manual -- dinheiro ou transferencia na recepcao.
   *
   * Permissao PROPRIA (`billing.payment.manual`), separada de
   * `billing.manage`: reconhecer dinheiro sem passar por provedor e ato
   * excepcional, e nem todo perfil do financeiro precisa dele. Mesmo
   * criterio de `access.override` na F9.
   */
  @Post('invoices/:id/manual-payment')
  @RequirePermissions('billing.payment.manual')
  async registrarPagamentoManual(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<InvoiceDto> {
    const dados = esquemaDePagamentoManual.parse(corpo);

    await this.billing.registrarPagamentoManual(
      this.contexto.require(),
      {
        invoiceId: id,
        amountMinor: dados.amountMinor,
        reason: dados.reason,
        paidAt: new Date(dados.paidAt),
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const completa = await this.billing.timelineDaInvoice(this.contexto.require(), id);

    return this.paraDto(completa!);
  }

  /**
   * Cria a cobranca PIX da invoice. `MVP-02` 13.
   *
   * `billing.manage`, nao `billing.payment.manual`: gerar cobranca e ato
   * comum do financeiro. Reconhecer dinheiro sem provedor e que e
   * excepcional -- por isso e a permissao separada.
   *
   * NAO CONFIRMA NADA: devolve QR e copia-e-cola. A confirmacao vem do
   * webhook (INV-076) ou da consulta ativa.
   */
  @Post('invoices/:id/payments/pix')
  @RequirePermissions('billing.manage')
  async criarCobrancaPix(
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<CobrancaPixDto> {
    const cobranca = await this.cobrancaPix.executar(
      this.contexto.require(),
      { invoiceId: id, agora: new Date() },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      paymentAttemptId: cobranca.paymentAttemptId,
      externalPaymentId: cobranca.externalPaymentId,
      copiaECola: cobranca.copiaECola,
      qrCodeDataUri: cobranca.qrCodeDataUri,
      expiresAt: cobranca.expiresAt.toISOString(),
      amountMinor: cobranca.amountMinor,
      currency: cobranca.currency,
    };
  }

  /**
   * Registra o metodo de pagamento tokenizado do aluno. Slice 2.3.
   *
   * O CORPO NAO TEM E NAO PODE TER DADO DE CARTAO (INV-098, `M2-FR-011`). O
   * token chega pronto do checkout hospedado do provedor -- o cartao vai do
   * navegador do aluno direto para a Getnet (ADR-032). O `.strict()` do
   * schema recusa a requisicao que trouxer `cardNumber` junto, em vez de
   * ignorar o campo e devolver 201 com o PAN ja tendo chegado ao servidor.
   */
  @Post('payment-methods')
  @RequirePermissions('billing.manage')
  async registrarMetodoDePagamento(@Body() corpo: unknown): Promise<MetodoDePagamentoDto> {
    const dados = esquemaDeMetodoTokenizado.parse(corpo);

    const metodo = await this.metodoDePagamento.executar(this.contexto.require(), dados);

    return {
      id: metodo.id,
      provider: metodo.provider,
      brand: metodo.brand,
      last4: metodo.last4,
      isDefault: metodo.isDefault,
    };
  }

  /**
   * Cobra a invoice no cartao padrao do aluno. Slice 2.3.
   *
   * NAO CONFIRMA PAGAMENTO -- devolve a tentativa. A confirmacao vem por
   * webhook (INV-076) ou pela consulta ativa, como no PIX.
   */
  @Post('invoices/:id/payments/card')
  @RequirePermissions('billing.manage')
  async cobrarNoCartao(@Param('id') id: string): Promise<CobrancaNoCartaoDto> {
    const cobranca = await this.cobrancaNoCartao.executar(this.contexto.require(), {
      invoiceId: id,
      agora: new Date(),
    });

    return {
      paymentAttemptId: cobranca.paymentAttemptId,
      externalSubscriptionId: cobranca.externalSubscriptionId,
      amountMinor: cobranca.amountMinor,
      currency: cobranca.currency,
    };
  }

  /**
   * Cria o checkout HOSPEDADO de cartao da invoice. F53, task 16 -- SPEC-053 9.
   *
   * DIFERENTE de `POST invoices/:id/payments/card`, acima: aquela cobra no
   * cartao TOKENIZADO que o aluno ja salvou; esta e a PRIMEIRA cobranca,
   * quando ainda nao ha token -- o aluno digita o cartao na pagina do
   * provedor, no proprio celular (INV-098). As duas rotas coexistem.
   *
   * `billing.manage`, mesma permissao da rota irma e da cobranca PIX: gerar
   * cobranca e ato comum do financeiro, nao excepcional.
   *
   * NAO CONFIRMA PAGAMENTO -- devolve link e QR. A confirmacao vem por
   * webhook (INV-076) ou pela consulta ativa, como no PIX e no cartao
   * tokenizado.
   *
   * Erros de dominio do caso de uso ja chegam com `status` certo
   * (`ProblemDetailsFilter` traduz `ErroDeDominio`): 422 para cadastro
   * incompleto (`STUDENT_BILLING_DATA_INCOMPLETE`), 409 para checkout ja em
   * andamento (`CARD_CHECKOUT_ALREADY_IN_FLIGHT`), 404 para invoice de outro
   * tenant ou inexistente -- por isso a rota so deixa o erro subir.
   */
  @Post('invoices/:id/payments/card-checkout')
  @RequirePermissions('billing.manage')
  async criarCheckoutDeCartao(
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<CheckoutDeCartaoDto> {
    const checkout = await this.checkoutDeCartao.executar(
      this.contexto.require(),
      { invoiceId: id, agora: new Date() },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      paymentAttemptId: checkout.paymentAttemptId,
      externalPaymentId: checkout.externalPaymentId,
      checkoutUrl: checkout.checkoutUrl,
      qrCodeDataUri: checkout.qrCodeDataUri,
      expiresAt: checkout.expiresAt.toISOString(),
      amountMinor: checkout.amountMinor,
      currency: checkout.currency,
    };
  }

  /**
   * Cancela a recorrencia de cartao da assinatura. Slice 2.3.
   *
   * CANCELAR A RECORRENCIA NAO CANCELA A ASSINATURA: o aluno que pagou ate o
   * dia 30 continua entrando ate o dia 30. Quem decide acesso e o entitlement
   * (regra de arquitetura no 1), e esta rota nao o toca.
   */
  @Post('subscriptions/:id/recurrence/cancel')
  @RequirePermissions('billing.manage')
  async cancelarRecorrencia(@Param('id') id: string): Promise<RecorrenciaCanceladaDto> {
    const resultado = await this.cancelamentoDeRecorrencia.executar(this.contexto.require(), {
      subscriptionId: id,
    });

    return {
      subscriptionId: resultado.subscriptionId,
      canceladasNoProvedor: resultado.canceladasNoProvedor,
    };
  }

  /**
   * O painel de inadimplencia e cobranca. Slice 2.4.
   *
   * SO LE: quem bloqueia e o job, quem desbloqueia e o webhook. Uma tela que
   * corrigisse estado faria a situacao do aluno depender de alguem te-la
   * aberto.
   */
  @Get('billing/delinquency')
  @RequirePermissions('billing.read')
  async consultarInadimplencia(): Promise<PainelDeInadimplenciaDto> {
    const painel = await this.inadimplencia.executar(this.contexto.require(), new Date());

    return {
      resumo: painel.resumo,
      faixas: [...painel.faixas],
      linhas: painel.linhas.map((linha) => ({
        ...linha,
        dueAt: linha.dueAt.toISOString(),
        liberadoAte: linha.liberadoAte?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Roda o job de vencimento sob demanda. `M2-FR-013`: reexecutavel.
   *
   * EXISTE COMO ROTA porque nao ha agendador no MVP 2 -- fila entra "so
   * quando comprovadamente necessario" (`CLAUDE.md`). Chamar duas vezes tem o
   * mesmo efeito de chamar uma, entao um agendador externo (cron do sistema)
   * resolve sem risco.
   */
  @Post('billing/delinquency/apply')
  @RequirePermissions('billing.manage')
  async aplicarInadimplenciaAgora(): Promise<ResultadoDaInadimplenciaDto> {
    return this.aplicarInadimplencia.executar(this.contexto.require().tenantId, new Date());
  }

  /**
   * Libera o acesso de quem esta devendo, por prazo. Slice 2.4.
   *
   * PERMISSAO PROPRIA, separada de `billing.manage`: liberar quem deve e ato
   * excepcional, e nem todo perfil do financeiro precisa dele. Mesmo criterio
   * de `billing.payment.manual` (F12) e `access.override` (F9).
   */
  @Post('billing/financial-overrides')
  @RequirePermissions('billing.override.financial')
  async liberarFinanceiramente(@Body() corpo: unknown): Promise<LiberacaoDto> {
    const dados = esquemaDeLiberacao.parse(corpo);

    const liberacao = await this.liberacao.conceder(this.contexto.require(), {
      ...dados,
      agora: new Date(),
    });

    return {
      id: liberacao.id,
      studentId: liberacao.studentId,
      expiresAt: liberacao.expiresAt.toISOString(),
    };
  }

  /** Encerra a liberacao antes do prazo, quando a recepcao percebe o engano. */
  @Post('billing/financial-overrides/:id/revoke')
  @RequirePermissions('billing.override.financial')
  @HttpCode(204)
  async revogarLiberacao(@Param('id') id: string): Promise<void> {
    await this.liberacao.revogar(this.contexto.require(), {
      overrideId: id,
      agora: new Date(),
    });
  }

  /**
   * Consulta ativa do status no provedor. `MVP-02` 13.
   *
   * `:id` E O ID DA TENTATIVA, nao do pagamento: no PIX o `Payment` so nasce
   * quando a confirmacao chega, entao antes disso nao existe id de pagamento
   * para consultar. A tentativa existe desde a criacao da cobranca, que e
   * justamente quando a consulta faz falta.
   *
   * SO LE. Se divergir, a resposta traz `divergente: true` -- e caso de
   * conciliacao (Slice 2.5), nao de confirmar por aqui.
   */
  @Get('payments/:id/status')
  @RequirePermissions('billing.read')
  async consultarStatus(@Param('id') id: string): Promise<StatusDePagamentoDto> {
    const status = await this.statusDePagamento.executar(this.contexto.require(), id);

    return {
      paymentAttemptId: status.paymentAttemptId,
      invoiceId: status.invoiceId,
      externalPaymentId: status.externalPaymentId,
      statusLocal: status.statusLocal,
      statusNoProvedor: status.statusNoProvedor,
      divergente: status.divergente,
      occurredAt: status.occurredAt.toISOString(),
    };
  }

  /**
   * Leitura barata para o laco da tela. `billing.read` e nao permissao nova:
   * e a mesma que ja le invoice e status de pagamento nesta rota vizinha --
   * quem pode ver a fatura pode ver se ela foi paga.
   *
   * SO O NOSSO BANCO. Ver docblock de `ConsultarTentativaUseCase` para o
   * porque de nao reusar `GET /payments/:id/status` aqui: aquela bate no
   * provedor a cada chamada, e o laco do balcao roda a cada 3s.
   */
  @Get('payment-attempts/:id')
  @RequirePermissions('billing.read')
  async observarTentativa(@Param('id') id: string): Promise<TentativaObservadaDto> {
    const observada = await this.tentativa.executar(this.contexto.require(), id);

    return {
      paymentAttemptId: observada.paymentAttemptId,
      status: observada.status,
      invoiceStatus: observada.invoiceStatus,
      paidAt: observada.paidAt?.toISOString() ?? null,
      receiptId: observada.receiptId,
      paymentId: observada.paymentId,
    };
  }

  /**
   * Lista transversal de faturas do tenant -- a visao de gestao. F53, task 6.
   *
   * Decisao 1 do PI em 23/08/2026: a spec propunha cortar esta rota, o PI
   * mandou implementar. `billing.read` -- mesma permissao das outras
   * leituras de invoice neste controller: quem ve a fatura do aluno pode ver
   * o financeiro do tenant inteiro.
   *
   * NAO FILTRA POR ALUNO: e o que a distingue de `GET
   * /students/:id/invoices`, logo abaixo.
   */
  @Get('invoices')
  @RequirePermissions('billing.read')
  async listar(@Query() consulta: unknown): Promise<PaginaDeInvoicesDto> {
    const filtro = esquemaDeListagem.parse(consulta);

    const pagina = await this.listagem.executar(this.contexto.require(), {
      ...(filtro.status ? { status: filtro.status } : {}),
      ...(filtro.vencendoDe ? { vencendoDe: new Date(filtro.vencendoDe) } : {}),
      ...(filtro.vencendoAte ? { vencendoAte: new Date(filtro.vencendoAte) } : {}),
      pagina: filtro.pagina,
      tamanho: filtro.tamanho,
    });

    return {
      itens: pagina.itens.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        billingPeriod: invoice.billingPeriod.toISOString(),
        totalMinor: invoice.totalMinor,
        dueAt: invoice.dueAt.toISOString(),
        paidAt: invoice.paidAt?.toISOString() ?? null,
        studentId: invoice.studentId,
      })),
      total: pagina.total,
      pagina: pagina.pagina,
      tamanho: pagina.tamanho,
    };
  }

  /**
   * SCHEMA DE RESPOSTA DECLARADO -- a primeira rota a sair da divida do FIX
   * #163, e nao por acaso: foi ELA que mudou de array para objeto na F53 sem
   * a guarda notar. `interface` do TypeScript nao chega ao OpenAPI (some na
   * compilacao), entao a forma vai explicita.
   */
  @Get('students/:id/invoices')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['timezone', 'invoices'],
      properties: {
        timezone: { type: 'string' },
        invoices: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @RequirePermissions('billing.read')
  async listarDoAluno(@Param('id') id: string): Promise<InvoicesDoAlunoDto> {
    const resposta = await this.billing.listarInvoicesDoAluno(this.contexto.require(), id);

    return {
      timezone: resposta.timezone,
      invoices: resposta.invoices.map((invoice) => this.paraDto(invoice)),
    };
  }

  /** Timeline financeira: o controle detectivo do ADR-027. */
  @Get('invoices/:id')
  @RequirePermissions('billing.read')
  async detalhar(@Param('id') id: string): Promise<InvoiceDto> {
    const invoice = await this.billing.timelineDaInvoice(this.contexto.require(), id);

    if (!invoice) {
      throw new NotFoundException('Invoice nao encontrada');
    }

    return this.paraDto(invoice);
  }

  private paraDto(invoice: InvoiceComTimeline | InvoiceComItens): InvoiceDto {
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      billingPeriod: invoice.billingPeriod.toISOString(),
      subtotalMinor: invoice.subtotalMinor,
      discountMinor: invoice.discountMinor,
      totalMinor: invoice.totalMinor,
      dueAt: invoice.dueAt.toISOString(),
      blockAt: invoice.blockAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmountMinor,
        totalMinor: item.totalMinor,
      })),
      payments: invoice.payments.map((pagamento) => ({
        id: pagamento.id,
        method: pagamento.method,
        status: pagamento.status,
        amountMinor: pagamento.amountMinor,
        paidAt: pagamento.paidAt?.toISOString() ?? null,
        recognizedByUserId: pagamento.recognizedByUserId,
      })),
    };
  }
}
