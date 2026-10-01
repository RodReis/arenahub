import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import { TEXTO_DO_RASCUNHO } from './formulario-do-termo';
import PaginaDoTermoBiometrico from './page';

async function renderizar() {
  const elemento = await PaginaDoTermoBiometrico();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

const VERSAO = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="version"]')?.value;

describe('termo biométrico (#491)', () => {
  /*
   * Arena Positiva, 01/10/2026: sem termo, o vinculo da base do leitor
   * vinculou zero de 428 alunos. A tela diz o porque e ja abre com o rascunho.
   */
  it('sem termo publicado, avisa e abre com o rascunho na versao 1', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        status: 404,
        title: 'Termo nao encontrado',
        code: 'CONSENT_DOCUMENT_NOT_FOUND',
        correlationId: 'c',
      },
      cookiesDaApi: [],
    });

    const { container } = await renderizar();

    expect(screen.getByTestId('sem-termo')).toBeInTheDocument();
    expect(screen.getByTestId('campo-texto-do-termo')).toHaveValue(TEXTO_DO_RASCUNHO);
    expect(VERSAO(container)).toBe('1');
  });

  it('com termo vigente, abre com o texto dele e publica a versao seguinte', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: {
        id: 'd',
        version: 3,
        purpose: 'Finalidade vigente da academia',
        content: 'Texto vigente do termo biometrico, com mais de cinquenta caracteres.',
        effectiveFrom: '2026-09-01T00:00:00.000Z',
      },
      cookiesDaApi: [],
    });

    const { container } = await renderizar();

    expect(screen.getByTestId('termo-vigente')).toBeInTheDocument();
    expect(screen.getByTestId('campo-texto-do-termo')).toHaveValue(
      'Texto vigente do termo biometrico, com mais de cinquenta caracteres.',
    );
    expect(VERSAO(container)).toBe('4');
  });

  it('sem permissao, mostra o problema em vez do formulario', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Proibido',
        status: 403,
        code: 'FORBIDDEN',
        correlationId: 'c',
      },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('erro-do-termo')).toBeInTheDocument();
    expect(screen.queryByTestId('publicar-termo')).not.toBeInTheDocument();
  });
});
