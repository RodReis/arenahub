import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { FilaDeContestacoes } from './fila-de-contestacoes';
import type { ContestacaoDaFila } from '../../../actions/engagement';

// Mockada ANTES do import do componente, como na fila de apelidos.
vi.mock('../../../actions/engagement', () => ({
  resolverContestacao: vi.fn(),
}));

const ABERTA: ContestacaoDaFila = {
  id: '11111111-1111-4111-8111-111111111111',
  studentId: '22222222-2222-4222-8222-222222222222',
  alunoNome: 'Ana Souza',
  subject: 'XP',
  descricao: 'Treinei terça e não pontuou.',
  status: 'ABERTA',
  resolucao: null,
  resolvedAt: null,
  createdAt: '2026-08-20T12:00:00.000Z',
};

function renderizar(itens: readonly ContestacaoDaFila[]) {
  return render(
    <ToastProvider>
      <FilaDeContestacoes itens={itens} />
    </ToastProvider>,
  );
}

describe('FilaDeContestacoes', () => {
  it('mostra vazio com saída quando não há contestação aberta', () => {
    renderizar([]);
    expect(screen.getByTestId('fila-de-contestacoes-vazia')).toBeInTheDocument();
  });

  it('mostra o aluno e o que ele escreveu', () => {
    renderizar([ABERTA]);
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Treinei terça e não pontuou.')).toBeInTheDocument();
  });

  it('traduz o assunto para palavra que a secretaria reconhece', () => {
    // `XP` é o enum do banco; quem opera a recepção lê "Pontos".
    renderizar([ABERTA]);
    expect(screen.getByText('Pontos')).toBeInTheDocument();
  });

  it('CORRIGI exige a resposta antes de habilitar o botão', async () => {
    renderizar([ABERTA]);

    await userEvent.click(screen.getByTestId(`corrigida-${ABERTA.id}`));
    expect(screen.getByTestId(`confirmar-${ABERTA.id}`)).toBeDisabled();

    await userEvent.type(screen.getByTestId(`resolucao-${ABERTA.id}`), 'Devolvidos 10 pontos.');
    expect(screen.getByTestId(`confirmar-${ABERTA.id}`)).toBeEnabled();
  });

  it('ESTAVA CORRETO também exige resposta -- improcedente sem explicação é silêncio com carimbo', async () => {
    // O canário da tela: se a resposta fosse obrigatória só no desfecho
    // CORRIGIDA, o aluno que perde nunca saberia por quê.
    renderizar([ABERTA]);

    await userEvent.click(screen.getByTestId(`improcedente-${ABERTA.id}`));
    expect(screen.getByTestId(`confirmar-${ABERTA.id}`)).toBeDisabled();

    await userEvent.type(
      screen.getByTestId(`resolucao-${ABERTA.id}`),
      'A catraca não registrou passagem naquele dia.',
    );
    expect(screen.getByTestId(`confirmar-${ABERTA.id}`)).toBeEnabled();
  });

  it('resposta só com espaço não habilita -- o trim é da tela também', async () => {
    renderizar([ABERTA]);

    await userEvent.click(screen.getByTestId(`corrigida-${ABERTA.id}`));
    await userEvent.type(screen.getByTestId(`resolucao-${ABERTA.id}`), '    ');

    expect(screen.getByTestId(`confirmar-${ABERTA.id}`)).toBeDisabled();
  });

  it('o rótulo do campo muda com o desfecho -- são respostas diferentes', async () => {
    renderizar([ABERTA]);

    await userEvent.click(screen.getByTestId(`corrigida-${ABERTA.id}`));
    expect(screen.getByLabelText(/o que foi corrigido/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    await userEvent.click(screen.getByTestId(`improcedente-${ABERTA.id}`));
    expect(screen.getByLabelText(/por que a pontuação está correta/i)).toBeInTheDocument();
  });

  it('Voltar limpa o que foi digitado -- desistir não deixa rascunho preso', async () => {
    renderizar([ABERTA]);

    await userEvent.click(screen.getByTestId(`corrigida-${ABERTA.id}`));
    await userEvent.type(screen.getByTestId(`resolucao-${ABERTA.id}`), 'rascunho');
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));

    await userEvent.click(screen.getByTestId(`corrigida-${ABERTA.id}`));
    expect(screen.getByTestId(`resolucao-${ABERTA.id}`)).toHaveValue('');
  });

  it('a secretaria não edita a contestação -- só decide sobre o que o aluno escreveu', () => {
    // Mesma invariante da fila de apelidos: não há campo para reescrever o
    // texto do aluno em lugar nenhum desta tela.
    renderizar([ABERTA]);
    expect(screen.queryByRole('textbox', { name: /o que o aluno escreveu/i })).not.toBeInTheDocument();
  });
});
