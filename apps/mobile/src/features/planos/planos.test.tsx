import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import type { StatusDaTentativa } from '../financeiro/usar-status-da-tentativa.js';
import { formatarDinheiro, Planos, type PagamentoDoApp } from './planos.js';
import type { DadosDaCobranca, DadosDoFinanceiro, DadosDoPlano } from './tipos.js';

const plano: DadosDoPlano = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  plano: {
    situacao: 'ACTIVE',
    inicioEm: '2026-08-01T00:00:00.000Z',
    fimEm: '2026-10-01T00:00:00.000Z',
    nome: 'Plano Mensal',
  },
};

const financeiro: DadosDoFinanceiro = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  invoices: [
    {
      invoiceId: 'invoice-1',
      status: 'OPEN',
      vencimentoEm: '2026-09-20T00:00:00.000Z',
      pagoEm: null,
      valorEmCentavos: 15000,
      moeda: 'BRL',
    },
    {
      invoiceId: 'invoice-2',
      status: 'PAID',
      vencimentoEm: '2026-08-20T00:00:00.000Z',
      pagoEm: '2026-08-18T13:00:00.000Z',
      valorEmCentavos: 15000,
      moeda: 'BRL',
    },
  ],
};

const pix: DadosDaCobranca = {
  paymentAttemptId: 'tentativa-1',
  qrCodeDataUri: 'data:image/png;base64,x',
  copiaECola: '000201...',
  checkoutUrl: null,
  expiraEm: '2026-09-12T10:30:00.000Z',
  valorEmCentavos: 15000,
  moeda: 'BRL',
};

const renderizar = ({
  dadosDoPlano = plano,
  dadosDoFinanceiro = financeiro,
  cobranca = null,
  status = null,
  pagamento = { iniciar: jest.fn(() => Promise.resolve(pix)), onCopiar: jest.fn(), onAbrirCheckout: jest.fn() },
  onCobranca = jest.fn(),
}: {
  dadosDoPlano?: DadosDoPlano | null;
  dadosDoFinanceiro?: DadosDoFinanceiro | null;
  cobranca?: DadosDaCobranca | null;
  status?: StatusDaTentativa | null;
  pagamento?: PagamentoDoApp;
  onCobranca?: (c: DadosDaCobranca | null) => void;
} = {}) => {
  render(
    <ProvedorDeTema forcarTema="dark">
      <Planos
        plano={dadosDoPlano}
        financeiro={dadosDoFinanceiro}
        cobranca={cobranca}
        statusDaTentativa={status}
        pagamento={pagamento}
        onCobranca={onCobranca}
        onPagamentoConcluido={jest.fn()}
      />
    </ProvedorDeTema>,
  );
  return { pagamento, onCobranca };
};

describe('formatarDinheiro', () => {
  it('centavos inteiros viram reais com virgula e milhar de pt-BR', () => {
    expect(formatarDinheiro(12990, 'BRL')).toBe('R$ 129,90');
    expect(formatarDinheiro(123456789, 'BRL')).toBe('R$ 1.234.567,89');
    expect(formatarDinheiro(5, 'BRL')).toBe('R$ 0,05');
  });
});

describe('Planos -- plano atual', () => {
  it('mostra a situacao e a validade do plano vigente', () => {
    renderizar();
    expect(screen.getByTestId('plano-situacao')).toHaveTextContent('Ativo');
    expect(screen.getAllByText(/01\/10\/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Plano Mensal')).toBeTruthy();
  });

  it('sem nome de plano NAO inventa nome comercial', () => {
    renderizar({ dadosDoPlano: { ...plano, plano: { ...plano.plano!, nome: null } } });
    expect(screen.getByTestId('plano-nome-ausente')).toHaveTextContent('Acesso sem plano assinado');
  });

  it('aluno SEM plano ve estado vazio, e nao um plano vencido inventado', () => {
    renderizar({ dadosDoPlano: { ...plano, plano: null } });
    expect(screen.getByTestId('plano-vazio')).toBeTruthy();
    expect(screen.queryByTestId('plano-situacao')).toBeNull();
  });

  it('NAO deriva vencimento no cliente -- ACTIVE com fim no passado segue Ativo', () => {
    renderizar({ dadosDoPlano: { ...plano, plano: { ...plano.plano!, fimEm: '2020-01-01T00:00:00.000Z' } } });
    expect(screen.getByTestId('plano-situacao')).toHaveTextContent('Ativo');
  });

  it('indisponivel mostra o SHELL, e nao o dado antigo', () => {
    renderizar({ dadosDoPlano: null, dadosDoFinanceiro: null });
    expect(screen.getByTestId('plano-indisponivel')).toBeTruthy();
    expect(screen.getByTestId('financeiro-indisponivel')).toBeTruthy();
    expect(screen.queryByText('Plano Mensal')).toBeNull();
    expect(screen.queryByText(/150,00/)).toBeNull();
  });
});

describe('Planos -- fatura e pagamento', () => {
  it('mostra valor, status do servidor e vencimento da fatura em aberto', () => {
    renderizar();
    expect(screen.getByTestId('fatura-status')).toHaveTextContent('Em aberto');
    expect(screen.getAllByText('R$ 150,00').length).toBeGreaterThan(0);
    expect(screen.getByText('vence em 20/09')).toBeTruthy();
  });

  it('sem fatura pagavel nao oferece pagamento', () => {
    renderizar({ dadosDoFinanceiro: { ...financeiro, invoices: [financeiro.invoices[1]!] } });
    expect(screen.queryByTestId('fatura-a-pagar')).toBeNull();
    expect(screen.queryByTestId('pagamento-pix')).toBeNull();
  });

  it('fatura paga aparece no historico com o rotulo compartilhado com o painel', () => {
    renderizar();
    expect(screen.getByTestId('pagamento-invoice-2')).toHaveTextContent(/Paga/);
    expect(screen.getByText('Pago em 18/08/2026')).toBeTruthy();
  });

  it('PIX so e gerado no toque -- abrir a aba nao cria cobranca', async () => {
    const { pagamento, onCobranca } = renderizar();
    expect(pagamento.iniciar).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('pagamento-pix'));

    await waitFor(() => expect(pagamento.iniciar).toHaveBeenCalledWith('invoice-1', 'pix'));
    await waitFor(() => expect(onCobranca).toHaveBeenCalledWith(pix));
  });

  it('PIX gerado mostra QR e copia-e-cola; copiar e acao explicita', () => {
    const { pagamento } = renderizar({ cobranca: pix });

    expect(screen.getByTestId('cobranca-qr')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cobranca-copiar'));
    expect(pagamento.onCopiar).toHaveBeenCalledWith('000201...');
  });

  it('"Ja fiz o PIX" leva a ESPERA, que nunca diz "pago" (M4-BR-001)', () => {
    renderizar({ cobranca: pix, status: { paymentAttemptId: 'tentativa-1', status: 'PENDING', statusDaFatura: 'OPEN', pagoEm: null } });

    fireEvent.press(screen.getByTestId('botao-ja-fiz-pix'));

    expect(screen.getByTestId('pagamento-aguardando')).toBeTruthy();
    expect(screen.queryByText(/pagamento confirmado|fatura paga/i)).toBeNull();
  });

  it('cartao NAO tem formulario proprio -- abre o checkout do provedor (INV-098)', async () => {
    const checkout: DadosDaCobranca = { ...pix, copiaECola: null, checkoutUrl: 'https://checkout.approved.test/session/x' };
    const pagamento = { iniciar: jest.fn(() => Promise.resolve(checkout)), onCopiar: jest.fn(), onAbrirCheckout: jest.fn() };
    renderizar({ pagamento });

    fireEvent.press(screen.getByTestId('metodo-checkout'));
    expect(screen.queryByLabelText(/número do cartão|cvv|validade/i)).toBeNull();

    fireEvent.press(screen.getByTestId('pagamento-checkout'));
    await waitFor(() => expect(pagamento.onAbrirCheckout).toHaveBeenCalledWith('https://checkout.approved.test/session/x'));
  });

  it('so o status do SERVIDOR confirma o pagamento', () => {
    renderizar({ cobranca: pix, status: { paymentAttemptId: 'tentativa-1', status: 'SUCCEEDED', statusDaFatura: 'PAID', pagoEm: '2026-09-12T12:00:00.000Z' } });
    expect(screen.getByTestId('pagamento-confirmado')).toBeTruthy();
  });

  it('falha ao iniciar avisa e deixa tentar de novo', async () => {
    const pagamento = { iniciar: jest.fn(() => Promise.reject(new Error('x'))), onCopiar: jest.fn(), onAbrirCheckout: jest.fn() };
    renderizar({ pagamento });

    fireEvent.press(screen.getByTestId('pagamento-pix'));
    expect(await screen.findByTestId('pagamento-erro')).toBeTruthy();
  });
});
