import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Cobranca, type DadosDaCobranca } from './cobranca.js';

const pix: DadosDaCobranca = {
  paymentAttemptId: 'tentativa-1',
  qrCodeDataUri: 'data:image/png;base64,x',
  copiaECola: '000201...',
  checkoutUrl: null,
  expiraEm: '2026-09-12T10:30:00.000Z',
  valorEmCentavos: 15000,
  moeda: 'BRL',
};

const checkout: DadosDaCobranca = {
  ...pix,
  copiaECola: null,
  checkoutUrl: 'https://checkout.approved.test/session/x',
};

const renderizar = (dados: DadosDaCobranca, onCopiar = () => {}, onAbrirCheckout = () => {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Cobranca dados={dados} onCopiar={onCopiar} onAbrirCheckout={onAbrirCheckout} />
    </ProvedorDeTema>,
  );

describe('Cobranca', () => {
  it('PIX mostra o codigo copia-e-cola e o QR', () => {
    renderizar(pix);

    expect(screen.getByTestId('cobranca-qr')).toBeTruthy();
    expect(screen.getByTestId('cobranca-copiar')).toBeTruthy();
    expect(screen.queryByTestId('cobranca-abrir-checkout')).toBeNull();
  });

  it('copiar aciona a acao explicita -- nao copia sozinho', () => {
    const onCopiar = jest.fn();
    renderizar(pix, onCopiar);

    fireEvent.press(screen.getByTestId('cobranca-copiar'));

    expect(onCopiar).toHaveBeenCalledWith('000201...');
  });

  it('checkout de cartao mostra o QR e o botao de abrir, sem copia-e-cola', () => {
    renderizar(checkout);

    expect(screen.getByTestId('cobranca-qr')).toBeTruthy();
    expect(screen.queryByTestId('cobranca-copiar')).toBeNull();
    expect(screen.getByTestId('cobranca-abrir-checkout')).toBeTruthy();
  });

  it('abrir checkout aciona a URL homologada do backend', () => {
    const onAbrirCheckout = jest.fn();
    renderizar(checkout, () => {}, onAbrirCheckout);

    fireEvent.press(screen.getByTestId('cobranca-abrir-checkout'));

    expect(onAbrirCheckout).toHaveBeenCalledWith('https://checkout.approved.test/session/x');
  });
});
