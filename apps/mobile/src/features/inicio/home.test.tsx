import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import type { AvisoDoAluno } from '../avisos/avisos.js';
import type { DadosDaFrequencia } from '../frequencia/frequencia.js';
import { Home, type ComplementosDaHome, type DadosDaHome } from './home.js';

const NOME_ANTERIOR = 'Ana Souza';

const base: DadosDaHome = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  saudacao: `Boa tarde, ${NOME_ANTERIOR.split(' ')[0] ?? ''}`,
  versionPolicy: { state: 'SUPPORTED', updateUrl: null },
};

const aviso: AvisoDoAluno = {
  id: 'aviso-1',
  tipo: 'BILLING',
  titulo: 'Fatura em aberto',
  corpo: 'Aguardando pagamento',
  rota: '/financeiro',
  lido: false,
  criadoEm: '2026-09-10T12:00:00.000Z',
};

const frequencia: DadosDaFrequencia = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  periodo: '90D',
  granularidade: 'SEMANAL',
  totalDeSessoes: 14,
  totalDePassagens: 16,
  baldes: [
    { rotulo: '2026-W35', sessoes: 3, passagens: 3 },
    { rotulo: '2026-W36', sessoes: 0, passagens: 0 },
  ],
  consistencia: { semanasComSessao: 1, semanasElegiveis: 2, proporcao: 0.5 },
};

const renderizar = (dados: Partial<DadosDaHome> = {}, complementos: ComplementosDaHome = {}) => {
  const acoes = {
    onAtualizarApp: jest.fn(),
    onVerPerfil: jest.fn(),
    onVerFrequencia: jest.fn(),
    onVerAvisos: jest.fn(),
    onAbrirAviso: jest.fn(),
    onVerDesafios: jest.fn(),
  };

  render(
    <ProvedorDeTema forcarTema="dark">
      <Home dados={{ ...base, ...dados }} complementos={complementos} {...acoes} />
    </ProvedorDeTema>,
  );

  return acoes;
};

describe('Home', () => {
  it('mostra o periodo e o primeiro nome que o servidor mandou', () => {
    renderizar();
    expect(screen.getByText('Boa tarde,')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('indisponivel mostra o SHELL, e nao o dado antigo como se fosse atual', () => {
    /*
     * `M4-NFR-002`. O perigo nao e a tela vazia -- e a tela que parece certa.
     */
    renderizar({ status: 'UNAVAILABLE', saudacao: `Boa tarde, ${NOME_ANTERIOR}` });

    expect(screen.getByText(/não foi possível atualizar agora/i)).toBeTruthy();
    expect(screen.queryByText(new RegExp(NOME_ANTERIOR, 'i'))).toBeNull();
  });

  it('NAO recalcula estado -- nao inventa vencimento nem atraso', () => {
    // `M4-BR-008`. Se a Home derivasse "vencida" de uma data, o app viraria
    // uma segunda autoridade sobre dinheiro.
    renderizar({}, { frequencia, avisos: [] });
    expect(screen.queryByText(/vencid|em atraso|inadimplen/i)).toBeNull();
  });

  it('versao BLOCKED impede seguir e oferece o caminho da atualizacao', () => {
    renderizar({ versionPolicy: { state: 'BLOCKED', updateUrl: 'https://exemplo.test' } });

    expect(screen.getByTestId('botao-atualizar')).toBeTruthy();
    expect(screen.queryByTestId('botao-perfil')).toBeNull();
  });

  it('GRACE nao bloqueia -- o aluno na catraca precisa entrar agora', () => {
    renderizar({ versionPolicy: { state: 'GRACE', updateUrl: 'https://exemplo.test' } });

    expect(screen.queryByTestId('botao-atualizar')).toBeNull();
    expect(screen.getByTestId('botao-perfil')).toBeTruthy();
  });

  it('nao oferece carteirinha -- cortada pelo PI na F24', () => {
    renderizar({}, { frequencia, avisos: [aviso] });
    expect(screen.queryByText(/carteirinha/i)).toBeNull();
  });

  describe('blocos secundarios', () => {
    it('leitura que ainda nao chegou NAO aparece como zero', () => {
      // Ausencia nao e zero: sem a frequencia, "0 treinos" afirmaria algo.
      renderizar();

      expect(screen.queryByTestId('home-frequencia')).toBeNull();
      expect(screen.queryByTestId('home-avisos')).toBeNull();
      expect(screen.queryByText(/0 treinos/)).toBeNull();
    });

    it('frequencia mostra o total que o servidor contou e abre o detalhe', () => {
      const acoes = renderizar({}, { frequencia, sequencia: 6 });

      expect(screen.getByText('14 treinos')).toBeTruthy();
      expect(screen.getByText('6 semanas seguidas treinando')).toBeTruthy();

      fireEvent.press(screen.getByTestId('home-frequencia'));
      expect(acoes.onVerFrequencia).toHaveBeenCalled();
    });

    it('sem sequencia, cai na consistencia do proprio periodo', () => {
      renderizar({}, { frequencia, sequencia: 0 });
      expect(screen.getByText('1 de 2 semanas com treino')).toBeTruthy();
    });

    it('aviso tocado vai inteiro para quem navega', () => {
      const acoes = renderizar({}, { avisos: [aviso] });

      fireEvent.press(screen.getByTestId('home-aviso-aviso-1'));
      expect(acoes.onAbrirAviso).toHaveBeenCalledWith(aviso);
    });

    it('desafio aberto vira o banner, com a data civil do fim', () => {
      renderizar({}, { desafio: { titulo: 'Desafio 4 treinos', meta: 4, fim: '2026-09-27', inscrito: false } });

      expect(screen.getByText('Desafio 4 treinos')).toBeTruthy();
      expect(screen.getByText(/Até 27\/09/)).toBeTruthy();
    });
  });

  /** Contador de avisos nao lidos -- F29. */
  describe('contador de avisos', () => {
    it('mostra a contagem quando ha nao lidos', () => {
      renderizar({ naoLidos: 3 }, { avisos: [aviso] });
      expect(screen.getByText('Ver todos (3)')).toBeTruthy();
    });

    it('omite a contagem quando esta tudo lido', () => {
      renderizar({ naoLidos: 0 }, { avisos: [aviso] });
      expect(screen.getByText('Ver todos')).toBeTruthy();
    });

    it('omite a contagem enquanto ela nao chegou', () => {
      // `undefined` e "ainda nao sei", e e diferente de zero.
      renderizar({}, { avisos: [aviso] });
      expect(screen.getByText('Ver todos')).toBeTruthy();
    });
  });
});
