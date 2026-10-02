import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('../../actions/instalador-android', () => ({
  salvarInstaladorAndroid: vi.fn(),
  removerInstaladorAndroid: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDoAplicativo from './page';

const CONFIGURADO = {
  androidUrl: 'https://expo.dev/artifacts/eas/abc.apk',
  androidVersion: '0.1.0 (build 8)',
  updatedAt: '2026-10-02T17:42:00.000Z',
  updatedByEmail: 'ana@arena.test',
  updatedByRole: 'MANAGER',
};

const VAZIO = {
  androidUrl: null,
  androidVersion: null,
  updatedAt: null,
  updatedByEmail: null,
  updatedByRole: null,
};

function responder(instalador: object, permissoes: string[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) =>
    Promise.resolve(
      caminho.endsWith('/auth/me')
        ? { ok: true, dados: { permissions: permissoes }, cookiesDaApi: [] }
        : { ok: true, dados: instalador, cookiesDaApi: [] },
    ),
  );
}

async function renderizar() {
  return render(<ToastProvider>{await PaginaDoAplicativo()}</ToastProvider>);
}

describe('pagina do aplicativo (#534)', () => {
  it('configurado: mostra QR, versao, link, copiar e quem atualizou com o perfil', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    expect(screen.getByTestId('qr-do-instalador').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('versao-do-instalador').textContent).toBe('Versão 0.1.0 (build 8)');
    expect(screen.getByTestId('link-do-instalador').textContent).toBe(CONFIGURADO.androidUrl);
    expect(screen.getByTestId('copiar-link')).toBeTruthy();
    expect(screen.getByTestId('autoria-do-instalador').textContent).toContain(
      'por ana@arena.test (Gerente)',
    );
  });

  it('sem link: estado vazio, nenhum QR', async () => {
    responder(VAZIO, ['student.read']);
    await renderizar();

    expect(screen.getByTestId('sem-instalador')).toBeTruthy();
    expect(screen.queryByTestId('qr-do-instalador')).toBeNull();
  });

  it('a recepcao (so student.read) nao ve o formulario', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    expect(screen.queryByTestId('formulario-do-instalador')).toBeNull();
  });

  it('quem tem user.manage ve o formulario com o link atual e o botao Remover', async () => {
    responder(CONFIGURADO, ['student.read', 'user.manage']);
    await renderizar();

    const campo = screen.getByTestId<HTMLInputElement>('campo-url-do-instalador');

    expect(campo.value).toBe(CONFIGURADO.androidUrl);
    expect(screen.getByTestId('remover-instalador')).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>('salvar-instalador').disabled).toBe(true);
  });

  it('sem link configurado o formulario nao oferece Remover', async () => {
    responder(VAZIO, ['student.read', 'user.manage']);
    await renderizar();

    expect(screen.queryByTestId('remover-instalador')).toBeNull();
  });

  it('falha ao carregar mostra o erro com o codigo, sem derrubar a tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL', correlationId: 'c' },
      cookiesDaApi: [],
    });
    await renderizar();

    expect(screen.getByTestId('erro-do-instalador')).toBeTruthy();
  });
});
