import { describe, expect, it, jest } from '@jest/globals';

import type { BillingRepository } from '../billing/billing.repository.js';
import type { ConsultarTentativaUseCase } from '../billing/consultar-tentativa.use-case.js';
import type { CriarCheckoutDeCartaoUseCase } from '../billing/criar-checkout-de-cartao.use-case.js';
import type { CriarCobrancaPixUseCase } from '../billing/criar-cobranca-pix.use-case.js';
import type { EmitirReciboUseCase } from '../billing/emitir-recibo.use-case.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { NaoEncontradoParaAlunoError } from './mobile-financeiro.service.js';
import { MobileFinanceiroService } from './mobile-financeiro.service.js';

const ctx: StudentChannelContext = {
  tenantId: 'tenant-1',
  studentId: 'aluno-1',
  accountId: 'conta-1',
  sessionId: 'sessao-1',
  reauthenticatedAt: null,
};

function criarFaturas() {
  return {
    listarInvoicesDoAluno: jest.fn<BillingRepository['listarInvoicesDoAluno']>(),
    buscarTentativaDoAluno: jest.fn<BillingRepository['buscarTentativaDoAluno']>(),
    buscarPagamentoDoAluno: jest.fn<BillingRepository['buscarPagamentoDoAluno']>(),
  };
}

function criarUseCases() {
  return {
    pix: { executar: jest.fn<CriarCobrancaPixUseCase['executar']>() },
    cartao: { executar: jest.fn<CriarCheckoutDeCartaoUseCase['executar']>() },
    tentativa: { executar: jest.fn<ConsultarTentativaUseCase['executar']>() },
    recibo: {
      executar: jest.fn<EmitirReciboUseCase['executar']>(),
      consultar: jest.fn<EmitirReciboUseCase['consultar']>(),
    },
  };
}

describe('MobileFinanceiroService', () => {
  describe('listarInvoices', () => {
    it('devolve as invoices do aluno da sessao, sem expor id de outro aluno', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [
          {
            id: 'invoice-1',
            status: 'OPEN',
            dueAt: new Date('2026-09-10T00:00:00.000Z'),
            paidAt: null,
            totalMinor: 15000,
            currency: 'BRL',
          },
        ],
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      const resposta = await service.listarInvoices(ctx);

      expect(faturas.listarInvoicesDoAluno).toHaveBeenCalledWith(
        { tenantId: 'tenant-1', actorId: null, sessionId: 'sessao-1', permissions: new Set(), allowedUnitIds: 'ALL' },
        'aluno-1',
      );
      expect(resposta.invoices).toEqual([
        {
          invoiceId: 'invoice-1',
          status: 'OPEN',
          vencimentoEm: '2026-09-10T00:00:00.000Z',
          pagoEm: null,
          valorEmCentavos: 15000,
          moeda: 'BRL',
        },
      ]);
    });
  });

  describe('criarPix', () => {
    it('recusa cobrar invoice que nao e do aluno da sessao', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [{ id: 'invoice-de-outro-aluno' }],
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      await expect(
        service.criarPix(ctx, 'invoice-inexistente', new Date(), 'corr-1'),
      ).rejects.toBeInstanceOf(NaoEncontradoParaAlunoError);

      expect(useCases.pix.executar).not.toHaveBeenCalled();
    });

    it('cobra a invoice do aluno via caso de uso do MVP 2, sem reimplementar cobranca', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();
      const agora = new Date('2026-09-12T10:00:00.000Z');

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [{ id: 'invoice-1' }],
      } as never);

      useCases.pix.executar.mockResolvedValue({
        paymentAttemptId: 'tentativa-1',
        qrCodeDataUri: 'data:image/png;base64,x',
        copiaECola: '000201...',
        expiresAt: new Date('2026-09-12T10:30:00.000Z'),
        amountMinor: 15000,
        currency: 'BRL',
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      const resultado = await service.criarPix(ctx, 'invoice-1', agora, 'corr-1');

      expect(useCases.pix.executar).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        { invoiceId: 'invoice-1', agora },
        'corr-1',
      );
      expect(resultado.paymentAttemptId).toBe('tentativa-1');
      expect(resultado.copiaECola).toBe('000201...');
    });

    it('chamar duas vezes para a mesma invoice nao cria duas tentativas -- o caso de uso reusa', async () => {
      /*
       * A idempotencia real (nao duplicar cobranca) mora no
       * `CriarCobrancaPixUseCase` (reuso de tentativa PENDING) e no indice
       * parcial do cartao -- nao neste service. O teste aqui prova so que o
       * service NAO adiciona logica propria por cima (ex.: gerar uma chave
       * de idempotencia diferente a cada chamada), o que quebraria o reuso
       * que o caso de uso ja faz.
       */
      const faturas = criarFaturas();
      const useCases = criarUseCases();
      const agora = new Date('2026-09-12T10:00:00.000Z');

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [{ id: 'invoice-1' }],
      } as never);

      useCases.pix.executar.mockResolvedValue({
        paymentAttemptId: 'tentativa-1',
        qrCodeDataUri: 'data:image/png;base64,x',
        copiaECola: '000201...',
        expiresAt: new Date('2026-09-12T10:30:00.000Z'),
        amountMinor: 15000,
        currency: 'BRL',
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      await service.criarPix(ctx, 'invoice-1', agora, 'corr-1');
      await service.criarPix(ctx, 'invoice-1', agora, 'corr-2');

      expect(useCases.pix.executar).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        { invoiceId: 'invoice-1', agora },
        'corr-1',
      );
      expect(useCases.pix.executar).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        { invoiceId: 'invoice-1', agora },
        'corr-2',
      );
    });
  });

  describe('criarCheckout', () => {
    it('recusa cartao de invoice que nao e do aluno da sessao', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [{ id: 'invoice-de-outro-aluno' }],
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      await expect(
        service.criarCheckout(ctx, 'invoice-inexistente', new Date(), 'corr-1'),
      ).rejects.toBeInstanceOf(NaoEncontradoParaAlunoError);

      expect(useCases.cartao.executar).not.toHaveBeenCalled();
    });

    it('abre o checkout hospedado via caso de uso do MVP 2', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();
      const agora = new Date('2026-09-12T10:00:00.000Z');

      faturas.listarInvoicesDoAluno.mockResolvedValue({
        timezone: 'America/Sao_Paulo',
        invoices: [{ id: 'invoice-1' }],
      } as never);

      useCases.cartao.executar.mockResolvedValue({
        paymentAttemptId: 'tentativa-2',
        checkoutUrl: 'https://checkout.approved.test/session/x',
        qrCodeDataUri: 'data:image/png;base64,y',
        expiresAt: new Date('2026-09-12T10:30:00.000Z'),
        amountMinor: 15000,
        currency: 'BRL',
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      const resultado = await service.criarCheckout(ctx, 'invoice-1', agora, 'corr-1');

      expect(useCases.cartao.executar).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        { invoiceId: 'invoice-1', agora },
        'corr-1',
      );
      expect(resultado.checkoutUrl).toBe('https://checkout.approved.test/session/x');
    });
  });

  describe('observarTentativa', () => {
    it('recusa observar tentativa que nao e de uma invoice do aluno da sessao', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.buscarTentativaDoAluno.mockResolvedValue(null);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      await expect(
        service.observarTentativa(ctx, 'tentativa-de-outro-aluno'),
      ).rejects.toBeInstanceOf(NaoEncontradoParaAlunoError);

      expect(useCases.tentativa.executar).not.toHaveBeenCalled();
    });

    it('le o status confirmado pelo webhook, nunca confirma pagamento sozinho', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.buscarTentativaDoAluno.mockResolvedValue({ id: 'tentativa-1' });
      useCases.tentativa.executar.mockResolvedValue({
        paymentAttemptId: 'tentativa-1',
        status: 'PROCESSING',
        invoiceStatus: 'OPEN',
        paidAt: null,
        receiptId: null,
        paymentId: null,
      });

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      const resultado = await service.observarTentativa(ctx, 'tentativa-1');

      expect(resultado.status).toBe('PROCESSING');
      expect(resultado.pagoEm).toBeNull();
    });
  });

  describe('emitirRecibo', () => {
    it('recusa emitir recibo de pagamento que nao e de uma invoice do aluno da sessao', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();

      faturas.buscarPagamentoDoAluno.mockResolvedValue(null);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      await expect(
        service.emitirRecibo(ctx, 'pagamento-de-outro-aluno', new Date()),
      ).rejects.toBeInstanceOf(NaoEncontradoParaAlunoError);

      expect(useCases.recibo.executar).not.toHaveBeenCalled();
    });

    it('emite o recibo do pagamento do aluno, idempotente por desenho do caso de uso', async () => {
      const faturas = criarFaturas();
      const useCases = criarUseCases();
      const agora = new Date('2026-09-12T10:00:00.000Z');

      faturas.buscarPagamentoDoAluno.mockResolvedValue({ id: 'pagamento-1' });
      useCases.recibo.executar.mockResolvedValue({
        receiptId: 'recibo-1',
        numero: 42,
        verificationHash: 'hash-1',
        snapshot: { tipo: 'RECIBO NÃO FISCAL' },
      } as never);

      const service = new MobileFinanceiroService(
        faturas as never,
        useCases.pix as never,
        useCases.cartao as never,
        useCases.tentativa as never,
        useCases.recibo as never,
      );

      const resultado = await service.emitirRecibo(ctx, 'pagamento-1', agora);

      expect(useCases.recibo.executar).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        { paymentId: 'pagamento-1', agora },
      );
      expect(resultado.receiptId).toBe('recibo-1');
    });
  });
});
