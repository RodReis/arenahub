import { render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Plano, type DadosDoPlano } from './plano.js';

const base: DadosDoPlano = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  plano: {
    situacao: 'ACTIVE',
    inicioEm: '2026-08-01T00:00:00.000Z',
    fimEm: '2026-10-01T00:00:00.000Z',
    nome: 'Plano Mensal',
  },
};

const renderizar = (dados: Partial<DadosDoPlano> = {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Plano dados={{ ...base, ...dados }} />
    </ProvedorDeTema>,
  );

describe('Plano', () => {
  it('mostra a situacao e a validade do plano vigente', () => {
    renderizar();

    expect(screen.getByText(/ativo/i)).toBeTruthy();
    expect(screen.getByText(/01\/10\/2026/)).toBeTruthy();
  });

  it('mostra o nome do plano quando ha assinatura', () => {
    renderizar();
    expect(screen.getByText('Plano Mensal')).toBeTruthy();
  });

  it('sem nome de plano mostra AUSENCIA, e nao um rotulo inventado', () => {
    /*
     * Cortesia e visitante nao tem plano a nomear. "Cortesia" escrito no
     * lugar do nome faria a tela exibir como plano o que e uma concessao --
     * DS-APP §10 regra 5: ausencia nao e zero, e nao e um rotulo de consolo.
     */
    renderizar({ plano: { ...base.plano!, nome: null } });

    expect(screen.getByTestId('plano-nome-ausente')).toBeTruthy();
  });

  it('aluno SEM plano ve estado vazio, e nao um plano vencido inventado', () => {
    renderizar({ plano: null });

    expect(screen.getByTestId('plano-vazio')).toBeTruthy();
    /*
     * Pelo testID do badge, e nao por `/ativo/i`: o titulo do estado vazio e
     * "Sem plano ativo", e a expressao casava com ele -- o teste passaria
     * mesmo se a tela exibisse um badge de situacao inventado.
     */
    expect(screen.queryByTestId('plano-situacao')).toBeNull();
  });

  it('indisponivel mostra o SHELL, e nao o dado antigo como se fosse atual', () => {
    /*
     * `M4-NFR-002`, a mesma regra da Home. Num app que fala de acesso, exibir
     * "plano ativo" de uma carga anterior faz o aluno sair de casa para
     * treinar com um direito que pode ter vencido.
     */
    renderizar({ status: 'UNAVAILABLE' });

    expect(screen.getByText(/não foi possível atualizar/i)).toBeTruthy();
    expect(screen.queryByText('Plano Mensal')).toBeNull();
  });

  it('NAO deriva vencimento no cliente -- a situacao vem do servidor', () => {
    /*
     * `M4-FR-006`: "sem inferir estado no cliente". O `fimEm` esta no PASSADO
     * e a situacao diz `ACTIVE` -- cenario que existe de verdade enquanto o
     * job de expiracao nao rodou. A tela tem de repetir o que o servidor
     * disse; comparar `fimEm` com o relogio do celular criaria uma segunda
     * autoridade sobre acesso, e relogio de celular erra.
     */
    renderizar({
      plano: { ...base.plano!, situacao: 'ACTIVE', fimEm: '2020-01-01T00:00:00.000Z' },
    });

    expect(screen.getByText(/ativo/i)).toBeTruthy();
    expect(screen.queryByText(/vencid/i)).toBeNull();
  });

  it('situacao suspensa aparece com o proprio texto', () => {
    renderizar({ plano: { ...base.plano!, situacao: 'SUSPENDED' } });
    expect(screen.getByText(/suspenso/i)).toBeTruthy();
  });
});
