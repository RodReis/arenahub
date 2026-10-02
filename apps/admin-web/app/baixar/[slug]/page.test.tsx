import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cabecalhos = { atual: new Headers() };

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(cabecalhos.atual) }));
vi.mock('../../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('../../../src/marca/ler-marca', () => ({
  lerMarca: vi.fn(() =>
    Promise.resolve({
      slug: 'arena-positiva',
      displayName: 'Arena Positiva',
      missionText: null,
      highlightsText: null,
      temLogo: false,
      temIcone: true,
    }),
  ),
}));

import { chamarApi } from '../../../lib/api/server-client';
import BaixarOApp, { generateMetadata } from './page';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A146M) Chrome/126 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';

function link(androidUrl: string | null) {
  vi.mocked(chamarApi).mockResolvedValue({
    ok: true,
    dados: { androidUrl, tenantSlug: 'arena-positiva' },
    cookiesDaApi: [],
  });
}

async function renderizar() {
  render(await BaixarOApp({ params: Promise.resolve({ slug: 'arena' }) }));
}

describe('/baixar/[final] -- pagina da academia (#538)', () => {
  beforeEach(() => {
    cabecalhos.atual = new Headers({ host: 'arenahub.test', 'x-forwarded-proto': 'https', 'user-agent': ANDROID });
  });

  it('mostra a academia e o botao Android apontando para o APK atual', async () => {
    link('https://expo.dev/a.apk');
    await renderizar();

    expect(screen.getByRole('heading', { name: 'Baixe o app da Arena Positiva' })).toBeTruthy();
    expect(screen.getByTestId('baixar-android').getAttribute('href')).toBe('https://expo.dev/a.apk');
    expect(screen.getByTestId('ios-em-breve').textContent).toContain('Em breve');
  });

  it('no iPhone, o lugar do iPhone vem primeiro e explica que esta a caminho', async () => {
    cabecalhos.atual = new Headers({ host: 'arenahub.test', 'user-agent': IPHONE });
    link('https://expo.dev/a.apk');
    await renderizar();

    const ios = screen.getByTestId('ios-em-breve');
    const android = screen.getByTestId('baixar-android');

    expect(ios.textContent).toContain('a caminho');
    expect(ios.compareDocumentPosition(android) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('final reservado sem APK no momento: avisa e nao oferece download', async () => {
    link(null);
    await renderizar();

    expect(screen.getByTestId('instalador-indisponivel')).toBeTruthy();
    expect(screen.queryByTestId('baixar-android')).toBeNull();
  });

  it('final inexistente: link nao encontrado', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 404, code: 'APP_LINK_NOT_FOUND', correlationId: 'c' },
      cookiesDaApi: [],
    });
    await renderizar();

    expect(screen.getByTestId('link-nao-encontrado')).toBeTruthy();
  });

  it('a previa do WhatsApp leva o nome da academia e base absoluta (sem ela a imagem some)', async () => {
    link('https://expo.dev/a.apk');

    const metadados = await generateMetadata({ params: Promise.resolve({ slug: 'arena' }) });

    expect(metadados.title).toBe('Baixe o app da Arena Positiva');
    expect(metadados.openGraph?.siteName).toBe('Arena Positiva');
    expect(String(metadados.metadataBase)).toBe('https://arenahub.test/');
  });
});
