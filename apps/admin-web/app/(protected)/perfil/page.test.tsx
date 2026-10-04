import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('../../actions/perfil', () => ({
  alterarSenha: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDePerfil from './page';

const PERFIL = {
  email: 'douglas@arenapositiva.com.br',
  createdAt: '2026-08-20T15:00:00.000Z',
  roles: ['OWNER'],
  tenant: { displayName: 'Clínica da Musculação', timezone: 'America/Sao_Paulo' },
};

async function renderizar() {
  return render(<ToastProvider>{await PaginaDePerfil()}</ToastProvider>);
}

describe('PaginaDePerfil', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('mostra os dados da conta com o perfil em portugues', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: PERFIL, cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByTestId('perfil-email')).toHaveTextContent(PERFIL.email);
    expect(screen.getByTestId('perfil-academia')).toHaveTextContent('Clínica da Musculação');
    expect(screen.getByTestId('perfil-papeis')).not.toHaveTextContent('OWNER');
    expect(screen.getByTestId('perfil-criada-em')).toHaveTextContent('20/08/2026');
    expect(screen.getByTestId('perfil-avatar')).toHaveTextContent('D');
  });

  it('oferece o formulario de troca de senha', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: PERFIL, cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Nova senha')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirmar nova senha')).toHaveAttribute('type', 'password');
  });

  it('sem fuso conhecido, a data aparece como ausente em vez de chutar um', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { ...PERFIL, tenant: { ...PERFIL.tenant, timezone: null } },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('perfil-criada-em')).not.toHaveTextContent('20/08/2026');
  });

  it('sem papel nenhum, o perfil aparece como ausente', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { ...PERFIL, roles: [] },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('perfil-papeis')).not.toHaveTextContent(/[a-z]/i);
  });

  it('erro da API vira ProblemDetail, sem formulario', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'x',
        status: 401,
        code: 'AUTH_REQUIRED',
        correlationId: 't',
      },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('erro-do-perfil')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
  });
});
