import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

/**
 * A Server Action fala com `chamarApi`, que e `server-only`. Nenhum teste
 * aqui completa uma chamada de verdade -- mesmo padrao de
 * `painel-do-placar.test.tsx`.
 */
vi.mock('../../../actions/engagement', () => ({
  criarDesafio: vi.fn(),
  ativarDesafio: vi.fn(),
}));

import { PainelDeDesafios } from './painel-de-desafios';
import type { TemplateDeDesafioDto } from '../../../actions/engagement';

const MODELO: TemplateDeDesafioDto = {
  id: 't-1',
  code: 'assiduidade-semanal',
  version: 1,
  name: 'Assiduidade semanal',
  maxSessoesPorSemana: 4,
  maxJanelaEmDias: 60,
};

const UNIDADE = { id: '11111111-1111-4111-8111-111111111111', name: 'Centro' };

function renderizar(modelos: TemplateDeDesafioDto[] = [MODELO]) {
  return render(
    <ToastProvider>
      <PainelDeDesafios modelos={modelos} unidades={[UNIDADE]} />
    </ToastProvider>,
  );
}

describe('PainelDeDesafios', () => {
  it('mostra o limite semanal do modelo na propria opcao', () => {
    renderizar();

    // A secretaria escolhe o modelo PELO limite -- e o que distingue um do
    // outro. Escondê-lo faria a escolha ser pelo nome, que não diz nada.
    expect(screen.getByRole('option', { name: /até 4 treinos por semana/i })).toBeInTheDocument();
  });

  it('a unidade padrao e "todas", nao a primeira da lista', () => {
    renderizar();

    // Desafio de tenant inteiro e o caso comum de uma academia de uma
    // unidade so. Pre-selecionar a primeira restringiria sem ninguem pedir.
    const unidade = screen.getByLabelText(/unidade/i);
    expect(unidade).toHaveValue('');
    expect(screen.getByRole('option', { name: /todas as unidades/i })).toBeInTheDocument();
  });

  /**
   * O TETO CALCULADO NA TELA usa o mesmo `Math.ceil` do dominio.
   *
   * 14 dias = 2 semanas; 2 x 4 = 8. Numero diferente aqui e la faria a tela
   * prometer meta que o servidor recusa.
   */
  it('mostra o teto da meta para o periodo escolhido', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/início/i), '2026-09-01');
    await usuario.type(screen.getByLabelText(/fim/i), '2026-09-14');

    expect(await screen.findByTestId('teto-da-janela')).toHaveTextContent('até 8 treinos');
  });

  /** Semana parcial conta como semana inteira -- 15 dias sao 3 semanas. */
  it('conta semana parcial como semana inteira no teto', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/início/i), '2026-09-01');
    await usuario.type(screen.getByLabelText(/fim/i), '2026-09-15');

    expect(await screen.findByTestId('teto-da-janela')).toHaveTextContent('até 12 treinos');
  });

  it('avisa quando o periodo passa do maximo do modelo', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/início/i), '2026-09-01');
    await usuario.type(screen.getByLabelText(/fim/i), '2026-12-31');

    expect(await screen.findByTestId('janela-longa-demais')).toHaveTextContent('60 dias');
    // Sem teto: a janela nem e valida, e mostrar um numero ali sugeriria que
    // basta ajustar a meta.
    expect(screen.queryByTestId('teto-da-janela')).not.toBeInTheDocument();
  });

  it('nao mostra teto com o periodo invertido', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/início/i), '2026-09-30');
    await usuario.type(screen.getByLabelText(/fim/i), '2026-09-01');

    expect(screen.queryByTestId('teto-da-janela')).not.toBeInTheDocument();
  });

  /**
   * ABRIR E UM SEGUNDO ATO.
   *
   * O desafio nasce fechado; sem criar nada, nao ha o que abrir. Um botao de
   * abrir sempre visivel sugeriria que existe desafio esperando.
   */
  it('nao oferece abrir inscricao antes de criar', () => {
    renderizar();

    expect(screen.getByTestId('sem-desafio-criado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abrir inscrição/i })).not.toBeInTheDocument();
  });

  it('avisa quando nao ha modelo cadastrado', () => {
    renderizar([]);

    // Sem modelo nao ha desafio a criar (`M5-FR-013`): o formulario inteiro
    // sai, em vez de ficar de pe com um select vazio.
    expect(screen.getByTestId('sem-modelos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /criar desafio/i })).not.toBeInTheDocument();
  });
});
