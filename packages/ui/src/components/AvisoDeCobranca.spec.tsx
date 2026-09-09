import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AvisoDeCobranca } from './AvisoDeCobranca.js';

/**
 * A faixa e AVISO DE COBRANCA, nao enfeite -- espelha ElevatedSessionBanner.
 *
 * O dono da academia precisa saber, sem abrir tela nenhuma, quanto falta ate
 * a catraca fechar por inadimplencia com a plataforma.
 */
describe('AvisoDeCobranca', () => {
  it('mostra dias restantes e valor em aberto', () => {
    render(<AvisoDeCobranca diasRestantes={7} emAbertoMinor={59_62_50} suspensa={false} />);

    expect(screen.getByText(/7 dias/)).toBeInTheDocument();
    expect(screen.getByText(/5\.962,50/)).toBeInTheDocument();
  });

  it('suspensa, troca a contagem por acesso bloqueado', () => {
    /*
     * Contagem regressiva que chegou a zero e continua contando e pior que
     * nenhuma: ela diz que ainda ha prazo quando a catraca ja fechou.
     */
    render(<AvisoDeCobranca diasRestantes={-3} emAbertoMinor={59_62_50} suspensa />);

    expect(screen.getByText(/acesso bloqueado/i)).toBeInTheDocument();
    expect(screen.queryByText(/dias/)).not.toBeInTheDocument();
  });

  it('no ultimo dia diz "hoje", nao "0 dias"', () => {
    render(<AvisoDeCobranca diasRestantes={0} emAbertoMinor={100_00} suspensa={false} />);

    expect(screen.getByText(/hoje/i)).toBeInTheDocument();
  });
});
