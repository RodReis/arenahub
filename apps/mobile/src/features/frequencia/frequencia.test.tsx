import { render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Frequencia, type DadosDaFrequencia } from './frequencia.js';

const base: DadosDaFrequencia = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  periodo: '30D',
  granularidade: 'SEMANAL',
  totalDeSessoes: 7,
  totalDePassagens: 9,
  baldes: [
    { rotulo: '2026-W36', sessoes: 3, passagens: 4 },
    { rotulo: '2026-W37', sessoes: 4, passagens: 5 },
  ],
  consistencia: { semanasComSessao: 2, semanasElegiveis: 4, proporcao: 0.5 },
};

const renderizar = (dados: Partial<DadosDaFrequencia> = {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Frequencia dados={{ ...base, ...dados }} onTrocarPeriodo={jest.fn()} />
    </ProvedorDeTema>,
  );

describe('Frequencia', () => {
  it('mostra DIAS treinados como numero principal', () => {
    // O aluno pensa a rotina em dias ("treinei 3x essa semana"), nao em
    // passagens. Passagem e auditoria do agrupamento, nao a manchete.
    renderizar();

    expect(screen.getByTestId('frequencia-total')).toHaveTextContent('7');
  });

  it('periodo sem treino mostra estado vazio, e nao "0 treinos" como conquista', () => {
    /*
     * DS-APP §10 regra 5. Um `0` grande no lugar do numero afirma sobre o
     * aluno um fato que a tela nao precisa cravar -- e o periodo pode estar
     * vazio porque ele acabou de se matricular.
     */
    renderizar({
      totalDeSessoes: 0,
      totalDePassagens: 0,
      baldes: [],
      consistencia: { semanasComSessao: 0, semanasElegiveis: 4, proporcao: 0 },
    });

    expect(screen.getByTestId('frequencia-vazia')).toBeTruthy();
  });

  it('indisponivel mostra o SHELL, e nao a serie antiga', () => {
    renderizar({ status: 'UNAVAILABLE' });

    expect(screen.getByText(/não foi possível atualizar/i)).toBeTruthy();
    expect(screen.queryByTestId('frequencia-total')).toBeNull();
  });

  it('lista um item por balde da serie', () => {
    renderizar();

    expect(screen.getByTestId('balde-2026-W36')).toBeTruthy();
    expect(screen.getByTestId('balde-2026-W37')).toBeTruthy();
  });

  it('consistencia sem semana elegivel aparece como AUSENTE, nunca como 0%', () => {
    /*
     * `proporcao: null` e o que o backend manda quando nao ha semana
     * elegivel -- dividir por zero daria `NaN` na tela. Exibir "0%" ali
     * afirmaria que o aluno nao treinou; a verdade e que nao ha periodo a
     * medir.
     */
    renderizar({
      consistencia: { semanasComSessao: 0, semanasElegiveis: 0, proporcao: null },
    });

    expect(screen.getByTestId('consistencia-ausente')).toBeTruthy();
  });
});
