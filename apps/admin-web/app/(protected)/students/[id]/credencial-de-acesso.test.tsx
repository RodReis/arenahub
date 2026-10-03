import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../actions/membership', () => ({ definirCredencial: vi.fn() }));

import { CredencialDeAcesso } from './credencial-de-acesso';

const ALUNO = '11111111-1111-4111-8111-111111111111';

function renderizar(credenciais: { kind: string; externalId: string }[]) {
  return render(
    <ToastProvider>
      <CredencialDeAcesso studentId={ALUNO} credenciais={credenciais} />
    </ToastProvider>,
  );
}

describe('CredencialDeAcesso', () => {
  it('com identificador facial, o numero aparece no visor em destaque', () => {
    renderizar([
      { kind: 'FACIAL_ENROLL_ID', externalId: '100000000007' },
      { kind: 'TURNSTILE_CARD', externalId: 'ABC-9' },
    ]);

    expect(screen.getByTestId('numero-em-destaque-valor').textContent?.replace(/\s/g, '')).toBe(
      '100000000007',
    );
    expect(screen.getByTestId('lista-de-credenciais')).toHaveTextContent('Cartão de catraca: ABC-9');
  });

  it('sem identificador facial, nao ha visor', () => {
    renderizar([{ kind: 'TURNSTILE_CARD', externalId: 'ABC-9' }]);

    expect(screen.queryByTestId('numero-em-destaque')).not.toBeInTheDocument();
  });
});
