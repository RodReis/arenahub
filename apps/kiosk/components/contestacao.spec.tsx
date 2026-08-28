import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessaoDoAluno } from '../lib/kiosk-client.js';
import { Contestacao } from './contestacao.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  abrirContestacao: vi.fn(),
}));

const { abrirContestacao } = await import('../lib/kiosk-client');

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: true, pendenciaEmCentavos: null },
  expiraEm: '2026-08-27T12:01:00.000Z',
};

const CRIADA = {
  id: '22222222-2222-4222-8222-222222222222',
  subject: 'XP' as const,
  descricao: 'Treinei terca e nao pontuou.',
  status: 'ABERTA' as const,
  resolucao: null,
  createdAt: '2026-08-20T12:00:00.000Z',
};

describe('Contestacao', () => {
  beforeEach(() => {
    vi.mocked(abrirContestacao).mockReset();
  });

  it('comeca fechada -- o formulario nao ocupa a tela de quem nao vai usar', () => {
    render(<Contestacao sessao={SESSAO} />);

    expect(screen.getByTestId('abrir-contestacao')).toBeInTheDocument();
    expect(screen.queryByTestId('formulario-de-contestacao')).not.toBeInTheDocument();
  });

  it('texto curto demais nao habilita o envio', async () => {
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.type(screen.getByTestId('descricao-da-contestacao'), 'ue');

    expect(screen.getByTestId('enviar-contestacao')).toBeDisabled();
  });

  it('texto so com espaco nao habilita -- o trim e da tela tambem', async () => {
    // O canario do minimo: medir o BRUTO deixaria passar oito espacos com
    // duas letras no meio, e a recepcao receberia linha sem conteudo.
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.type(screen.getByTestId('descricao-da-contestacao'), '        ab   ');

    expect(screen.getByTestId('enviar-contestacao')).toBeDisabled();
  });

  it('envia o texto APARADO e o assunto escolhido', async () => {
    vi.mocked(abrirContestacao).mockResolvedValue(CRIADA);
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.selectOptions(screen.getByTestId('assunto-da-contestacao'), 'RANKING');
    await userEvent.type(
      screen.getByTestId('descricao-da-contestacao'),
      '  Minha posicao esta errada.  ',
    );
    await userEvent.click(screen.getByTestId('enviar-contestacao'));

    await waitFor(() => {
      expect(abrirContestacao).toHaveBeenCalledWith(
        SESSAO.sessionId,
        SESSAO.token,
        'RANKING',
        'Minha posicao esta errada.',
      );
    });
  });

  it('confirma o recebimento sem pedir mais nada do aluno', async () => {
    vi.mocked(abrirContestacao).mockResolvedValue(CRIADA);
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.type(screen.getByTestId('descricao-da-contestacao'), 'Faltaram pontos.');
    await userEvent.click(screen.getByTestId('enviar-contestacao'));

    expect(await screen.findByTestId('contestacao-enviada')).toBeInTheDocument();
  });

  it('falha diz o que fazer e MANTEM o texto -- reescrever em pe e o pior desfecho', async () => {
    // O canario do erro: limpar o campo na falha faria o aluno digitar tudo
    // de novo num teclado de totem, em pe, com fila atras.
    vi.mocked(abrirContestacao).mockResolvedValue(null);
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.type(screen.getByTestId('descricao-da-contestacao'), 'Faltaram pontos.');
    await userEvent.click(screen.getByTestId('enviar-contestacao'));

    expect(await screen.findByTestId('contestacao-falhou')).toBeInTheDocument();
    expect(screen.getByTestId('descricao-da-contestacao')).toHaveValue('Faltaram pontos.');
  });

  it('Voltar limpa o rascunho -- desistir nao deixa texto preso para o proximo aluno', async () => {
    // O totem e COMPARTILHADO: o rascunho do aluno anterior visivel para o
    // proximo seria vazamento entre pessoas na mesma tela.
    render(<Contestacao sessao={SESSAO} />);

    await userEvent.click(screen.getByTestId('abrir-contestacao'));
    await userEvent.type(screen.getByTestId('descricao-da-contestacao'), 'rascunho qualquer');
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    await userEvent.click(screen.getByTestId('abrir-contestacao'));

    expect(screen.getByTestId('descricao-da-contestacao')).toHaveValue('');
  });

  it('nao pede nem mostra dado de outro aluno', () => {
    // A tela publica do totem nunca carrega nome de terceiro, e a de
    // contestacao tambem nao: nao ha campo de "quem" em lugar nenhum.
    render(<Contestacao sessao={SESSAO} />);
    expect(screen.queryByLabelText(/aluno|matricula|cpf/i)).not.toBeInTheDocument();
  });
});
