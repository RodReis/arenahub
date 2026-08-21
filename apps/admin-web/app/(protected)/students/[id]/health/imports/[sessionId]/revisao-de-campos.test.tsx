import { render as renderSemProvider, screen, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { ToastProvider } from '@arenahub/ui';

import { PainelDeAnalise } from './painel-de-analise';
import { RevisaoDeCampos, type LinhaDeRevisao } from './revisao-de-campos';

/**
 * Testes da revisão multiarquivo -- Task 9.
 *
 * As Server Actions chamam `chamarApi`, que é `server-only` e falaria com a
 * API de verdade; aqui elas nunca disparam (nenhum teste submete o
 * formulário), então o mock só existe para o módulo carregar em `jsdom`.
 */
vi.mock('../../../../../../actions/assessment-imports', () => ({
  confirmarSessao: vi.fn(),
  revisarCampo: vi.fn(),
}));

/**
 * `RevisaoDeCampos` chama `useToastDeErro`, que exige `<ToastProvider>` --
 * na tela real ele vem do layout (`app/(protected)/layout.tsx`); aqui cada
 * teste precisa do mesmo ancestral para o componente montar.
 */
function render(ui: ReactElement): RenderResult {
  return renderSemProvider(<ToastProvider>{ui}</ToastProvider>);
}

const linhaConcordante: LinhaDeRevisao = {
  type: 'WEIGHT',
  concordante: true,
  origens: ['Balança', 'App de análise'],
  campos: [
    {
      id: 'campo-1',
      type: 'WEIGHT',
      extractedValue: 82.4,
      extractedUnit: 'KG',
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      importId: 'import-1',
    },
  ],
};

const linhaDivergente: LinhaDeRevisao = {
  type: 'BODY_FAT_PERCENT',
  concordante: false,
  origens: ['Balança', 'App de análise'],
  campos: [
    {
      id: 'campo-2a',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 18.2,
      extractedUnit: 'PERCENT',
      sourceLabel: 'Balança',
      state: 'PENDING',
      importId: 'import-1',
    },
    {
      id: 'campo-2b',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 19.5,
      extractedUnit: 'PERCENT',
      sourceLabel: 'App de análise',
      state: 'PENDING',
      importId: 'import-2',
    },
  ],
};

const linhaSemValor: LinhaDeRevisao = {
  type: 'VISCERAL_FAT_LEVEL',
  concordante: true,
  origens: ['Balança'],
  campos: [
    {
      id: 'campo-3',
      type: 'VISCERAL_FAT_LEVEL',
      extractedValue: null,
      extractedUnit: null,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      importId: 'import-1',
    },
  ],
};

describe('revisao de campos', () => {
  it('mostra campo concordante numa linha so, com as duas origens', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2); // cabecalho + 1
    expect(screen.getByText(/2 arquivos/i)).toBeInTheDocument();
  });

  it('mostra divergencia como duas linhas, SEM pre-selecao', () => {
    render(<RevisaoDeCampos linhas={[linhaDivergente]} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it('desabilita confirmar enquanto houver divergencia aberta', () => {
    render(
      <RevisaoDeCampos
        linhas={[linhaDivergente]}
        podeConfirmar={{ pronta: false, motivo: 'DIVERGENCE_UNRESOLVED' }}
      />,
    );

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/escolha qual valor vale/i)).toBeInTheDocument();
  });

  it('exibe o achado do ECG como texto do aparelho, sem acao', () => {
    render(<PainelDeAnalise atributos={{ ecgFinding: 'Ritmo nao classificado' }} />);

    expect(screen.getByText(/ritmo nao classificado/i)).toBeInTheDocument();
    expect(screen.getByText(/relatado pelo aparelho/i)).toBeInTheDocument();
    // ADR-035 e decisao 2 do PI: nada de encaminhamento nesta tela.
    expect(screen.queryByRole('button', { name: /encaminhamento/i })).not.toBeInTheDocument();
  });

  it('mostra valor ausente como travessao, nunca como zero', () => {
    render(<RevisaoDeCampos linhas={[linhaSemValor]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
