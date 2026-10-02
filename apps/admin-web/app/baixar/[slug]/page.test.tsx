import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { chamarApi } from '../../../lib/api/server-client';
import BaixarOApp from './page';

describe('/baixar/[final] (#538)', () => {
  it('redireciona para o APK atual do final do link', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { androidUrl: 'https://expo.dev/a.apk' },
      cookiesDaApi: [],
    });

    await expect(BaixarOApp({ params: Promise.resolve({ slug: 'arena' }) })).rejects.toThrow(
      'REDIRECT:https://expo.dev/a.apk',
    );
    expect(chamarApi).toHaveBeenCalledWith('/api/v1/public/app-links/arena');
  });

  it('final sem APK ativo mostra a pagina de indisponivel, sem redirecionar', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 404, code: 'APP_LINK_NOT_FOUND', correlationId: 'c' },
      cookiesDaApi: [],
    });

    render(await BaixarOApp({ params: Promise.resolve({ slug: 'arena' }) }));

    expect(screen.getByTestId('instalador-indisponivel')).toBeTruthy();
  });
});
