import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Avisos, type AvisoDoAluno, type DadosDosAvisos } from './avisos.js';

const aviso = (over: Partial<AvisoDoAluno> = {}): AvisoDoAluno => ({
  id: 'aviso-1',
  tipo: 'BILLING',
  titulo: 'Fatura em aberto',
  corpo: 'Você tem uma fatura aguardando pagamento.',
  rota: '/financeiro?invoice=a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b',
  lido: false,
  criadoEm: '2026-09-14T10:00:00.000Z',
  ...over,
});

function renderizar(dados: Partial<DadosDosAvisos> = {}, onAbrir = jest.fn()) {
  const base: DadosDosAvisos = {
    asOf: '2026-09-14T12:00:00.000Z',
    status: 'AVAILABLE',
    avisos: [aviso()],
    naoLidos: 1,
  };

  render(
    <ProvedorDeTema forcarTema="dark">
      <Avisos dados={{ ...base, ...dados }} onAbrir={onAbrir} testID="avisos" />
    </ProvedorDeTema>,
  );

  return onAbrir;
}

describe('Avisos', () => {
  it('lista o aviso com titulo e corpo', () => {
    renderizar();

    expect(screen.getByText(/fatura em aberto/i)).toBeTruthy();
    expect(screen.getByText(/aguardando pagamento/i)).toBeTruthy();
  });

  it('marca visualmente o nao lido', () => {
    renderizar({ avisos: [aviso({ lido: false })] });

    expect(screen.getByTestId('aviso-aviso-1-nao-lido')).toBeTruthy();
  });

  it('nao marca o que ja foi lido', () => {
    renderizar({ avisos: [aviso({ lido: true })] });

    expect(screen.queryByTestId('aviso-aviso-1-nao-lido')).toBeNull();
  });

  /**
   * O estado precisa chegar a quem usa leitor de tela.
   *
   * O ponto de nao lido e visual; sozinho, ele deixa a distincao invisivel
   * para quem navega por audio -- e "fatura em aberto" lida e nao lida sao
   * coisas diferentes.
   */
  it('anuncia o estado de leitura para o leitor de tela', () => {
    renderizar({ avisos: [aviso({ lido: false })] });

    expect(screen.getByLabelText(/^Não lido\./)).toBeTruthy();
  });

  it('entrega o aviso tocado a quem navega', () => {
    const onAbrir = renderizar();

    fireEvent.press(screen.getByTestId('aviso-aviso-1'));

    expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ id: 'aviso-1' }));
  });

  it('mostra o estado vazio quando nao ha aviso', () => {
    renderizar({ avisos: [], naoLidos: 0 });

    expect(screen.getByTestId('avisos-vazio')).toBeTruthy();
  });

  // Falha de rede vira AUSENCIA declarada, nunca dado antigo apresentado como
  // atual (`M4-NFR-002`): a tela vazia incomoda, a que PARECE certa engana.
  it('declara a indisponibilidade em vez de mostrar lista vazia', () => {
    renderizar({ status: 'UNAVAILABLE', avisos: [], naoLidos: 0 });

    expect(screen.getByText(/sem conexão/i)).toBeTruthy();
    expect(screen.queryByTestId('avisos-vazio')).toBeNull();
  });

  /**
   * A TELA NAO RECALCULA NADA. Rota, contagem e visibilidade vem prontas do
   * servidor -- recalcular criaria uma segunda verdade que divergiria da
   * primeira, e a divergencia so apareceria comparando a bolinha com a lista.
   */
  it('navega pela rota que o servidor resolveu, sem monta-la', () => {
    const onAbrir = renderizar({
      avisos: [aviso({ rota: '/frequencia' })],
    });

    fireEvent.press(screen.getByTestId('aviso-aviso-1'));

    expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ rota: '/frequencia' }));
  });

  it('exibe aviso sem rota do mesmo jeito', () => {
    // Aviso que so informa ("a academia fecha no feriado") nao navega, mas
    // continua sendo um aviso a mostrar.
    renderizar({ avisos: [aviso({ rota: null, tipo: 'GENERAL', titulo: 'Feriado' })] });

    expect(screen.getByText(/feriado/i)).toBeTruthy();
  });

  it('lista varios avisos', () => {
    renderizar({
      avisos: [
        aviso({ id: 'a', titulo: 'Primeiro' }),
        aviso({ id: 'b', titulo: 'Segundo', tipo: 'ASSESSMENT' }),
      ],
      naoLidos: 2,
    });

    expect(screen.getByTestId('aviso-a')).toBeTruthy();
    expect(screen.getByTestId('aviso-b')).toBeTruthy();
  });
});
