import { render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Home, type DadosDaHome } from './home.js';

const NOME_ANTERIOR = 'Ana Souza';

const base: DadosDaHome = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  saudacao: `Boa tarde, ${NOME_ANTERIOR.split(' ')[0] ?? ''}`,
  versionPolicy: { state: 'SUPPORTED', updateUrl: null },
};

const renderizar = (dados: Partial<DadosDaHome> = {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Home
        dados={{ ...base, ...dados }}
        onSair={jest.fn()}
        onAtualizarApp={jest.fn()}
      />
    </ProvedorDeTema>,
  );

describe('Home', () => {
  it('mostra a saudacao quando o servidor respondeu', () => {
    renderizar();
    expect(screen.getByText(/boa tarde/i)).toBeTruthy();
  });

  it('indisponivel mostra o SHELL, e nao o dado antigo como se fosse atual', () => {
    /*
     * `M4-NFR-002`. O perigo nao e a tela vazia -- e a tela que parece certa.
     * Num app que fala de plano, fatura e acesso, mostrar dado vencido como
     * atual faz o aluno decidir sobre informacao que ja mudou.
     */
    renderizar({ status: 'UNAVAILABLE', saudacao: `Boa tarde, ${NOME_ANTERIOR}` });

    expect(screen.getByText(/não foi possível atualizar agora/i)).toBeTruthy();
    expect(screen.queryByText(new RegExp(NOME_ANTERIOR, 'i'))).toBeNull();
  });

  it('NAO recalcula estado -- nao inventa vencimento nem atraso', () => {
    // `M4-BR-008`. Se a Home derivasse "vencida" de uma data, o app viraria
    // uma segunda autoridade sobre dinheiro.
    renderizar();
    expect(screen.queryByText(/vencid|em atraso|inadimplen/i)).toBeNull();
  });

  it('versao BLOCKED impede seguir e oferece o caminho da atualizacao', () => {
    renderizar({ versionPolicy: { state: 'BLOCKED', updateUrl: 'https://exemplo.test' } });

    expect(screen.getByTestId('botao-atualizar')).toBeTruthy();
    // E nao deixa passar: a Home normal nao aparece junto.
    expect(screen.queryByTestId('botao-sair')).toBeNull();
  });

  it('GRACE nao bloqueia -- o aluno na catraca precisa entrar agora', () => {
    // Obrigar a baixar 40 MB na porta da academia e pior do que deixar
    // passar com a versao de ontem.
    renderizar({ versionPolicy: { state: 'GRACE', updateUrl: 'https://exemplo.test' } });

    expect(screen.queryByTestId('botao-atualizar')).toBeNull();
    expect(screen.getByTestId('botao-sair')).toBeTruthy();
  });
});
