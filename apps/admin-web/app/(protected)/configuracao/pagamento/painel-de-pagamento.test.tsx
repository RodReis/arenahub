import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { PainelDePagamento } from './painel-de-pagamento';

vi.mock('../../../actions/configuracao-de-pagamento', () => ({
  salvarConfiguracaoDePagamento: vi.fn(),
}));

const INICIAL = { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 };
const NOVEMBRO_DE_2026 = { ano: 2026, mes: 11 };

function renderizar(podeEditar = true) {
  return render(
    <ToastProvider>
      <PainelDePagamento inicial={INICIAL} referencia={NOVEMBRO_DE_2026} podeEditar={podeEditar} />
    </ToastProvider>,
  );
}

/** `userEvent.type` num number input com valor: limpa e digita o novo. */
async function digitar(testId: string, valor: string) {
  const campo = screen.getByTestId(testId);
  await userEvent.clear(campo);
  await userEvent.type(campo, valor);
}

describe('PainelDePagamento', () => {
  it('abre com os valores gravados e o exemplo do mês de referência', () => {
    renderizar();

    expect(screen.getByTestId('config-gerar')).toHaveValue(1);
    expect(screen.getByTestId('config-vencer')).toHaveValue(10);
    expect(screen.getByTestId('config-bloqueio')).toHaveValue(5);
    expect(screen.getByTestId('config-exemplo')).toHaveTextContent(
      'Parcela de nov/26: gerada em 01/11, vence em 10/11, catraca bloqueia em 15/11 às 00:00.',
    );
  });

  it('mudar o vencimento atualiza o exemplo na hora', async () => {
    renderizar();

    await digitar('config-vencer', '28');

    expect(screen.getByTestId('config-exemplo')).toHaveTextContent(
      'Parcela de nov/26: gerada em 01/11, vence em 28/11, catraca bloqueia em 03/12 às 00:00.',
    );
  });

  it('gerar depois de vencer mostra o motivo e desabilita Salvar', async () => {
    renderizar();

    await digitar('config-gerar', '15');

    expect(screen.getByText('O dia de gerar não pode ser depois do dia do vencimento.')).toBeInTheDocument();
    expect(screen.getByTestId('config-salvar')).toBeDisabled();
    expect(screen.getByTestId('config-exemplo')).not.toHaveTextContent('Parcela de');
  });

  it('valor fora do limite desabilita Salvar', async () => {
    renderizar();

    await digitar('config-bloqueio', '31');

    expect(screen.getByText('Informe de 1 a 30 dias.')).toBeInTheDocument();
    expect(screen.getByTestId('config-salvar')).toBeDisabled();
  });

  it('campo vazio desabilita Salvar', async () => {
    renderizar();

    await userEvent.clear(screen.getByTestId('config-vencer'));

    expect(screen.getByTestId('config-salvar')).toBeDisabled();
  });

  it('valores válidos deixam Salvar habilitado e avisam que parcela já gerada não muda', () => {
    renderizar();

    expect(screen.getByTestId('config-salvar')).toBeEnabled();
    expect(
      screen.getByText('A mudança vale para as próximas parcelas. As parcelas já geradas não mudam.'),
    ).toBeInTheDocument();
  });

  it('sem permissão de editar: campos travados, sem Salvar, valores à vista', () => {
    renderizar(false);

    for (const id of ['config-gerar', 'config-vencer', 'config-bloqueio']) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.queryByTestId('config-salvar')).not.toBeInTheDocument();
    expect(screen.getByTestId('config-vencer')).toHaveValue(10);
    expect(screen.getByTestId('config-exemplo')).toHaveTextContent('vence em 10/11');
  });

  it('os rótulos e as ajudas são os da especificação', () => {
    renderizar();

    expect(screen.getByLabelText('Dia de gerar as parcelas')).toBeInTheDocument();
    expect(screen.getByLabelText('Dia do vencimento')).toBeInTheDocument();
    expect(screen.getByLabelText('Dias de bloqueio após o vencimento')).toBeInTheDocument();
    expect(
      screen.getByText('Quantos dias depois do vencimento a catraca deixa de liberar quem não pagou.'),
    ).toBeInTheDocument();
  });
});
