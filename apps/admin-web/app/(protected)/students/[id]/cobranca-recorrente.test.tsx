import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../actions/recorrencia', () => ({
  aderirARecorrencia: vi.fn(),
  cancelarRecorrencia: vi.fn(),
}));

import { CobrancaRecorrente } from './cobranca-recorrente';

const PADRAO = {
  subscriptionId: '11111111-1111-4111-8111-111111111111',
  billingMode: 'ASSINATURA' as const,
  ativa: false,
  amountMinor: 15000,
  currency: 'BRL',
  dueDay: 10,
};

function montar(sobrescritas: Partial<React.ComponentProps<typeof CobrancaRecorrente>> = {}) {
  return render(
    <ToastProvider>
      <CobrancaRecorrente {...PADRAO} {...sobrescritas} />
    </ToastProvider>,
  );
}

describe('cobranca recorrente na ficha do aluno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('diz que plano avulso nao tem cobranca automatica, em vez de sumir', () => {
    montar({ billingMode: 'AVULSO' });

    expect(screen.getByTestId('plano-nao-e-assinatura')).toBeInTheDocument();
    expect(screen.queryByTestId('form-de-adesao')).toBeNull();
  });

  /*
   * OS TRES FATOS ANTES DO ACEITE (`SPEC-056` 2.2): quanto, quando e como
   * sair. Sem eles o aceite e em branco -- e debito surpresa e o que gera
   * contestacao.
   */
  it('mostra valor, dia e como cancelar ANTES do aceite', () => {
    montar();

    const formulario = screen.getByTestId('form-de-adesao');

    expect(formulario).toHaveTextContent('R$ 150,00');
    expect(formulario).toHaveTextContent(/dia 10/);
    expect(formulario).toHaveTextContent(/encerrar a qualquer momento/i);
  });

  it('so habilita o botao depois do aceite', async () => {
    const usuario = userEvent.setup();
    montar();

    const botao = screen.getByTestId('ativar-recorrencia');
    expect(botao).toBeDisabled();

    await usuario.click(screen.getByTestId('aceite-da-recorrencia'));

    expect(botao).toBeEnabled();
  });

  /*
   * Sem preco vigente nao ha valor a mostrar, e pedir o aceite assim seria
   * autorizacao em branco. A API tambem recusa
   * (`PLAN_WITHOUT_ACTIVE_PRICE`) -- a tela da a frase que resolve.
   */
  it('recusa a adesao quando o plano perdeu o preco vigente', () => {
    montar({ amountMinor: null });

    expect(screen.getByTestId('plano-sem-preco-vigente')).toBeInTheDocument();
    expect(screen.queryByTestId('aceite-da-recorrencia')).toBeNull();
  });

  describe('quando a recorrencia ja esta ativa', () => {
    it('mostra o encerramento como acao visivel, sem fricao', () => {
      montar({ ativa: true });

      expect(screen.getByTestId('recorrencia-ativa')).toBeInTheDocument();
      expect(screen.getByTestId('encerrar-recorrencia')).toBeEnabled();
      // Nao pede aceite de novo para SAIR.
      expect(screen.queryByTestId('aceite-da-recorrencia')).toBeNull();
    });

    it('avisa que encerrar NAO tira o acesso ja pago', () => {
      montar({ ativa: true });

      expect(screen.getByTestId('recorrencia-ativa')).toHaveTextContent(
        /não tira o acesso já pago/i,
      );
    });
  });
});
