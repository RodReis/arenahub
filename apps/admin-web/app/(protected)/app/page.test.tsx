import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

const cabecalhos = { atual: new Headers({ host: 'arenahub.test', 'x-forwarded-proto': 'https' }) };

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(cabecalhos.atual),
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
  shortSlug: 'arena',
  messageTemplate: null,
  academia: 'Arena Positiva',
  slugSugerido: 'arena-positiva',
};

const VAZIO = {
  androidUrl: null,
  androidVersion: null,
  updatedAt: null,
  updatedByEmail: null,
  updatedByRole: null,
  shortSlug: null,
  messageTemplate: null,
  academia: 'Arena Positiva',
  slugSugerido: 'arena-positiva',
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
    // Com final reservado, o aluno recebe o LINK CURTO, nao o APK direto.
    expect(screen.getByTestId('link-do-instalador').textContent).toBe('https://arenahub.test/baixar/arena');
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
  it('mensagem pronta usa o link curto e o nome da academia', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    const previa = screen.getByTestId('previa-da-mensagem').textContent ?? '';

    expect(previa).toContain('https://arenahub.test/baixar/arena');
    expect(previa).toContain('Arena Positiva');
    expect(screen.getByTestId('abrir-no-whatsapp')).toBeTruthy();
  });

  it('sem final reservado, link e mensagem caem no APK direto', async () => {
    responder({ ...CONFIGURADO, shortSlug: null }, ['student.read']);
    await renderizar();

    expect(screen.getByTestId('link-do-instalador').textContent).toBe(CONFIGURADO.androidUrl);
  });

  it('o QR e um botao que abre a versao ampliada', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    expect(screen.getByTestId('ampliar-qr').tagName).toBe('BUTTON');
    expect(screen.getByTestId('dialogo-qr').querySelector('svg')).not.toBeNull();
  });

  it('atras de varios proxies usa o PRIMEIRO host da lista', async () => {
    cabecalhos.atual = new Headers({
      'x-forwarded-host': 'painel.arena.test, interno.railway',
      'x-forwarded-proto': 'https, http',
    });
    responder(CONFIGURADO, ['student.read']);
    await renderizar();
    cabecalhos.atual = new Headers({ host: 'arenahub.test', 'x-forwarded-proto': 'https' });

    expect(screen.getByTestId('link-do-instalador').textContent).toBe(
      'https://painel.arena.test/baixar/arena',
    );
  });

  it('sem sugestao valida, o final do link vem vazio e nao trava o salvamento do APK', async () => {
    responder({ ...VAZIO, slugSugerido: null }, ['student.read', 'user.manage']);
    await renderizar();

    expect(screen.getByTestId<HTMLInputElement>('campo-final-do-link').value).toBe('');
  });

  it('o formulario sugere o identificador da academia como final do link', async () => {
    responder({ ...VAZIO }, ['student.read', 'user.manage']);
    await renderizar();

    expect(screen.getByTestId<HTMLInputElement>('campo-final-do-link').value).toBe('arena-positiva');
  });
  it('o iPhone ja tem lugar reservado: chip "em breve"', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    expect(screen.getByTestId('ios-em-breve').textContent).toContain('iPhone');
  });

  it('final SUGERIDO ainda nao reservado acende o Salvar -- senao o link curto nunca nascia', async () => {
    responder({ ...CONFIGURADO, shortSlug: null }, ['student.read', 'user.manage']);
    await renderizar();

    expect(screen.getByTestId<HTMLInputElement>('campo-final-do-link').value).toBe('arena-positiva');
    expect(screen.getByTestId<HTMLButtonElement>('salvar-instalador').disabled).toBe(false);
  });

  it('quem administra edita a mensagem ao lado da previa; a recepcao so ve a previa', async () => {
    responder(CONFIGURADO, ['student.read', 'user.manage']);
    const { unmount } = await renderizar();
    expect(screen.getByTestId('campo-mensagem-do-instalador')).toBeTruthy();
    unmount();

    responder(CONFIGURADO, ['student.read']);
    await renderizar();
    expect(screen.queryByTestId('campo-mensagem-do-instalador')).toBeNull();
    expect(screen.getByTestId('previa-da-mensagem')).toBeTruthy();
  });

  it('envio em abas: quem administra ve tres, a recepcao nenhuma -- a pagina cabe sem rolagem', async () => {
    responder(CONFIGURADO, ['student.read', 'user.manage']);
    const { unmount } = await renderizar();
    expect(screen.getAllByRole('tab').map((aba) => aba.textContent)).toEqual([
      'Mensagem ao aluno',
      'Editar texto',
      'Instalador',
    ]);
    unmount();

    responder(CONFIGURADO, ['student.read']);
    await renderizar();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('o link no balao e clicavel e abre em aba nova', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();

    const links = screen.getByTestId('previa-da-mensagem').querySelectorAll('a');
    const doTexto = [...links].find((a) => a.textContent === 'https://arenahub.test/baixar/arena');

    expect(doTexto?.getAttribute('href')).toBe('https://arenahub.test/baixar/arena');
    expect(doTexto?.getAttribute('target')).toBe('_blank');
  });
});
