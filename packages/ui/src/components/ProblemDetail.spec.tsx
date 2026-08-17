import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProblemDetail } from './ProblemDetail.js';

const PROBLEMA = {
  type: 'https://arenahub.dev/errors/device-sync-timeout',
  title: 'Não foi possível sincronizar o dispositivo',
  status: 504,
  code: 'DEVICE_SYNC_TIMEOUT',
  correlationId: 'a1b2c3d4',
};

describe('ProblemDetail', () => {
  it('mostra titulo, contexto, acao e codigo -- os quatro campos do §8.1', () => {
    render(
      <ProblemDetail
        problem={PROBLEMA}
        context="Catraca 02 · Recepção"
        hint="verifique a rede local e tente novamente."
      />,
    );

    expect(screen.getByText('Não foi possível sincronizar o dispositivo')).toBeInTheDocument();
    expect(screen.getByText('Catraca 02 · Recepção')).toBeInTheDocument();
    expect(screen.getByText(/verifique a rede local/)).toBeInTheDocument();
    expect(screen.getByText(/DEVICE_SYNC_TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument();
  });

  it('e um alerta para o leitor de tela', () => {
    render(<ProblemDetail problem={PROBLEMA} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  /**
   * O componente e burro de PROPOSITO.
   *
   * `application/problem+json` permite campo extra, e a API pode ganhar um
   * `detail` tecnico numa fatia futura. Sem este teste, um dia o IP da catraca
   * aparece na tela da recepcao -- e em log de erro do navegador, que e onde
   * PII nunca pode estar (§8.1: sem stack, sem detalhe interno).
   */
  it('nao renderiza stack nem detalhe interno mesmo se vier no payload', () => {
    const comVazamento = {
      ...PROBLEMA,
      stack: 'Error: at DeviceService.sync (/app/src/device.ts:42)',
      detail: 'connection refused 192.168.2.188:7792',
    } as typeof PROBLEMA;

    render(<ProblemDetail problem={comVazamento} />);

    expect(screen.queryByText(/DeviceService\.sync/)).not.toBeInTheDocument();
    expect(screen.queryByText(/192\.168\.2\.188/)).not.toBeInTheDocument();
  });

  it('so mostra o botao de repetir quando ha o que repetir', () => {
    const { rerender } = render(<ProblemDetail problem={PROBLEMA} />);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();

    rerender(<ProblemDetail problem={PROBLEMA} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('contexto e acao sao opcionais -- nem todo erro sabe o proximo passo', () => {
    render(<ProblemDetail problem={PROBLEMA} />);

    expect(screen.getByText('Não foi possível sincronizar o dispositivo')).toBeInTheDocument();
    expect(screen.queryByText(/O que fazer/)).not.toBeInTheDocument();
  });
});
