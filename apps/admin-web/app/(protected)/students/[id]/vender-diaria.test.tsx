import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

const venderDiaria = vi.hoisted(() => vi.fn());

vi.mock('../../../actions/membership', () => ({ venderDiaria }));

import { VenderDiaria, type PlanoDeDiaria } from './vender-diaria';

const ALUNO = '11111111-1111-4111-8111-111111111111';
const PLANO: PlanoDeDiaria = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Diaria',
  amountMinor: 3000,
  currency: 'BRL',
};

function montar(sobrescritas: Partial<React.ComponentProps<typeof VenderDiaria>> = {}) {
  return render(
    <ToastProvider>
      <VenderDiaria studentId={ALUNO} planos={[PLANO]} impedido={false} {...sobrescritas} />
    </ToastProvider>,
  );
}

async function abrir() {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByTestId('abrir-venda-de-diaria'));

  return usuario;
}

describe('vender diaria na ficha do aluno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fica fechada ate a recepcao pedir', () => {
    montar();

    expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
    expect(screen.queryByTestId('venda-de-diaria')).toBeNull();
  });

  it('mostra o valor da diaria antes de confirmar', async () => {
    montar();
    await abrir();

    expect(screen.getByTestId('diaria-valor')).toHaveTextContent('R$ 30,00');
  });

  it('confirma com o preco que a tela mostrou e dinheiro como forma padrao', async () => {
    venderDiaria.mockResolvedValue({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));

    await waitFor(() =>
      expect(venderDiaria).toHaveBeenCalledWith({
        studentId: ALUNO,
        planId: PLANO.id,
        channel: 'DINHEIRO',
        expectedTotalMinor: 3000,
      }),
    );
    expect(await screen.findByText(/Diária paga/)).toBeInTheDocument();
  });

  it('manda a forma de pagamento escolhida', async () => {
    venderDiaria.mockResolvedValue({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('forma-pix'));
    await usuario.click(screen.getByTestId('confirmar-diaria'));

    await waitFor(() =>
      expect(venderDiaria).toHaveBeenCalledWith(expect.objectContaining({ channel: 'PIX' })),
    );
  });

  it('mostra o erro da API num aviso e nao diz que pagou', async () => {
    venderDiaria.mockResolvedValue({ ok: false, error: 'Este aluno já tem plano vigente.' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));

    expect(await screen.findByText('Este aluno já tem plano vigente.')).toBeInTheDocument();
    expect(screen.queryByText(/Diária paga/)).toBeNull();
  });

  it('bloqueia o botao enquanto envia: clique duplo nao vende duas vezes', async () => {
    let liberar: (v: unknown) => void = () => undefined;
    venderDiaria.mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));
    await usuario.click(screen.getByTestId('confirmar-diaria'));

    expect(venderDiaria).toHaveBeenCalledTimes(1);
    liberar({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
  });

  it('se a action lancar, avisa e destrava o botao', async () => {
    venderDiaria.mockRejectedValue(new Error('rede caiu'));
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));

    expect(await screen.findByText(/Não foi possível vender a diária/)).toBeInTheDocument();
    expect(screen.getByTestId('confirmar-diaria')).toBeEnabled();
  });

  it('com mais de um plano de diaria, pede a escolha', async () => {
    montar({
      planos: [
        PLANO,
        { ...PLANO, id: '33333333-3333-4333-8333-333333333333', name: 'Diaria promo', amountMinor: 2500 },
      ],
    });
    await abrir();

    expect(screen.getByTestId('diaria-plano')).toBeInTheDocument();
  });

  it('sem plano de diaria ativo, explica o que fazer em vez de esconder', () => {
    montar({ planos: [] });

    expect(screen.getByTestId('sem-plano-de-diaria')).toHaveTextContent(/Planos/);
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });

  it('aluno com acesso impedido nao ve o botao e ve o motivo', () => {
    montar({ impedido: true });

    expect(screen.getByTestId('diaria-impedida')).toBeInTheDocument();
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });
});
