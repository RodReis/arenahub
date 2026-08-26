import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@arenahub/ui';
import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';

import { FormularioDeConfiguracao } from './formulario-de-configuracao';

/*
 * As Server Actions falam com `chamarApi`, que e `server-only`. Nenhum
 * teste aqui completa um envio de verdade -- o mock existe so para o modulo
 * carregar em `jsdom` (mesmo padrao de `formulario-de-cadastro.test.tsx`).
 */
vi.mock('../../../../actions/kiosk-config', () => ({
  salvarRascunhoAction: vi.fn(),
  publicarAction: vi.fn(),
  descartarAction: vi.fn(),
}));

const estado = {
  publicada: { version: 2, config: CONFIG_PADRAO_DO_TOTEM },
  rascunho: null,
  efetiva: CONFIG_PADRAO_DO_TOTEM,
  configVersion: 2,
  totemEmSessao: false,
};

function renderizar(props: Parameters<typeof FormularioDeConfiguracao>[0]) {
  return render(
    <ToastProvider>
      <FormularioDeConfiguracao {...props} />
    </ToastProvider>,
  );
}

describe('FormularioDeConfiguracao', () => {
  it('oferece as quatro cores como escolha, nunca campo de hex', async () => {
    const usuario = userEvent.setup();
    renderizar({ estado, kioskDeviceId: 'k1' });

    await usuario.click(screen.getByRole('tab', { name: /aparência/i }));

    for (const accent of ['AZUL', 'VERDE', 'LARANJA', 'ROXO']) {
      expect(screen.getByRole('radio', { name: new RegExp(accent, 'i') })).toBeInTheDocument();
    }

    expect(screen.queryByLabelText(/hex|cor personalizada/i)).not.toBeInTheDocument();
  });

  it('incremento e teto aparecem como texto fixo, nao como campo', async () => {
    const usuario = userEvent.setup();
    renderizar({ estado, kioskDeviceId: 'k1' });

    await usuario.click(screen.getByRole('tab', { name: /sessão/i }));

    expect(screen.getByText(/30 s/)).toBeInTheDocument();
    expect(screen.getByText(/99 s/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /incremento|teto/i })).not.toBeInTheDocument();
  });

  it('diz que o botao do aluno vence o padrao da unidade', async () => {
    const usuario = userEvent.setup();
    renderizar({ estado, kioskDeviceId: 'k1' });

    await usuario.click(screen.getByRole('tab', { name: /aparência/i }));

    expect(screen.getByText(/vence|prevalece/i)).toBeInTheDocument();
  });

  it('com totem em sessao, avisa que a publicacao aguarda', () => {
    renderizar({
      estado: { ...estado, totemEmSessao: true, rascunho: { config: CONFIG_PADRAO_DO_TOTEM } },
      kioskDeviceId: 'k1',
    });

    expect(screen.getByText(/aguardando o totem ficar livre/i)).toBeInTheDocument();
  });

  it('sem rascunho, nao oferece publicar nem descartar', () => {
    renderizar({ estado, kioskDeviceId: 'k1' });

    expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descartar/i })).not.toBeInTheDocument();
  });

  it('com rascunho, oferece publicar e descartar', () => {
    renderizar({
      estado: { ...estado, rascunho: { config: CONFIG_PADRAO_DO_TOTEM } },
      kioskDeviceId: 'k1',
    });

    expect(screen.getByRole('button', { name: /publicar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar/i })).toBeInTheDocument();
  });

  it('campo nao sobrescrito mostra o valor herdado e de onde vem', async () => {
    const usuario = userEvent.setup();
    const efetivaComSlogan = {
      ...CONFIG_PADRAO_DO_TOTEM,
      marca: { ...CONFIG_PADRAO_DO_TOTEM.marca, slogan: 'Treine forte' },
    };

    renderizar({
      estado: { ...estado, efetiva: efetivaComSlogan },
      kioskDeviceId: 'k1',
    });

    await usuario.click(screen.getByRole('tab', { name: /marca/i }));

    expect(screen.getByText(/herdado/i)).toBeInTheDocument();
  });
});
