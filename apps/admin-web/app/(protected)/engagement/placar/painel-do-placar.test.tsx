import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

/**
 * A Server Action fala com `chamarApi`, que e `server-only`. Nenhum teste
 * aqui completa uma chamada de verdade -- mesmo padrao de
 * `editar-cadastro.test.tsx` e `fila-de-moderacao.test.tsx`.
 */
vi.mock('../../../actions/engagement', () => ({
  gerarPlacar: vi.fn(),
  publicarPlacar: vi.fn(),
  ajustarXp: vi.fn(),
}));

import { ajustarXp, gerarPlacar, publicarPlacar } from '../../../actions/engagement';
import { PainelDoPlacar } from './painel-do-placar';

const UNIDADE = { id: 'unidade-1', name: 'Centro', timezone: 'America/Sao_Paulo' };

function renderizar() {
  return render(
    <ToastProvider>
      <PainelDoPlacar unidades={[UNIDADE]} />
    </ToastProvider>,
  );
}

describe('PainelDoPlacar', () => {
  it('sem campo de edicao de posicao ou de movimento', () => {
    renderizar();

    // O painel so GERA, PUBLICA e AJUSTA -- nunca reescreve uma posicao ou
    // um movimento ja gravado (M5-AC-007, M5-FR-007).
    expect(screen.queryByLabelText(/posi[cç][aã]o/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
  });

  it('gera o placar e mostra DRAFT com botao de publicar', async () => {
    vi.mocked(gerarPlacar).mockResolvedValue({
      snapshot: {
        id: 'snap-1',
        category: 'XP_DO_MES',
        status: 'DRAFT',
        publishedAt: null,
        entries: [{ studentId: 'a1', position: 1, points: 30 }],
      },
    });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByTestId('gerar-placar'));

    expect(await screen.findByTestId('snapshot-gerado')).toBeInTheDocument();
    expect(screen.getByTestId('publicar-placar')).toBeInTheDocument();
  });

  /*
   * `M5-BR-007`: coorte abaixo do minimo NAO E ERRO -- e a politica
   * funcionando. O aviso explica isso, e NAO ha botao de publicar.
   */
  it('WITHHELD explica que a coorte ficou abaixo do minimo, sem botao de publicar', async () => {
    vi.mocked(gerarPlacar).mockResolvedValue({
      snapshot: { id: 'snap-2', category: 'XP_DO_MES', status: 'WITHHELD', publishedAt: null, entries: [] },
    });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByTestId('gerar-placar'));

    expect(await screen.findByTestId('aviso-withheld')).toHaveTextContent(/mínimo/i);
    expect(screen.queryByTestId('publicar-placar')).not.toBeInTheDocument();
  });

  it('publicar mostra a data e nao oferece publicar de novo', async () => {
    vi.mocked(gerarPlacar).mockResolvedValue({
      snapshot: { id: 'snap-3', category: 'XP_DO_MES', status: 'DRAFT', publishedAt: null, entries: [] },
    });
    vi.mocked(publicarPlacar).mockResolvedValue({
      snapshot: {
        id: 'snap-3',
        category: 'XP_DO_MES',
        status: 'PUBLISHED',
        publishedAt: '2026-08-27T12:00:00.000Z',
        entries: [],
      },
    });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByTestId('gerar-placar'));
    await usuario.click(await screen.findByTestId('publicar-placar'));

    expect(await screen.findByTestId('placar-publicado')).toBeInTheDocument();
    expect(screen.queryByTestId('publicar-placar')).not.toBeInTheDocument();
  });

  /*
   * Erro de `useActionState` nao e evento -- precisa de efeito que compare a
   * mensagem (memoria erro-de-useactionstate-nao-e-evento). O toast e quem
   * prova que o erro chegou na tela.
   */
  it('erro ao gerar aparece como toast', async () => {
    vi.mocked(gerarPlacar).mockResolvedValue({ erro: 'Não foi possível gerar o placar.' });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByTestId('gerar-placar'));

    expect(await screen.findByText('Não foi possível gerar o placar.')).toBeInTheDocument();
  });

  it('ajuste exige motivo antes de habilitar o envio', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByTestId('aluno-do-ajuste'), 'aluno-1');
    await usuario.type(screen.getByTestId('pontos-do-ajuste'), '-10');

    expect(screen.getByTestId('confirmar-ajuste')).toBeDisabled();

    await usuario.type(screen.getByTestId('motivo-do-ajuste'), 'passagem corrigida');

    expect(screen.getByTestId('confirmar-ajuste')).toBeEnabled();
  });

  it('ajuste bem sucedido confirma e limpa o formulario', async () => {
    vi.mocked(ajustarXp).mockResolvedValue({ sucesso: true });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByTestId('aluno-do-ajuste'), 'aluno-1');
    await usuario.type(screen.getByTestId('pontos-do-ajuste'), '-10');
    await usuario.type(screen.getByTestId('motivo-do-ajuste'), 'passagem corrigida');
    await usuario.click(screen.getByTestId('confirmar-ajuste'));

    expect(await screen.findByTestId('ajuste-registrado')).toBeInTheDocument();

    // `waitFor`, e nao asserção direta: a limpeza mora num `useEffect` que roda
    // DEPOIS do render que mostra `ajuste-registrado`. Assertar entre os dois
    // passa na máquina rápida e falha na lenta -- foi o que aconteceu no CI em
    // 31/08/2026, num PR que não tocou em `admin-web`.
    await waitFor(() => {
      expect(screen.getByTestId('pontos-do-ajuste')).toHaveValue(null);
      expect(screen.getByTestId('motivo-do-ajuste')).toHaveValue('');
    });
  });

  it('erro no ajuste aparece como toast', async () => {
    vi.mocked(ajustarXp).mockResolvedValue({ erro: 'Aluno não encontrado.' });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByTestId('aluno-do-ajuste'), 'aluno-inexistente');
    await usuario.type(screen.getByTestId('pontos-do-ajuste'), '-10');
    await usuario.type(screen.getByTestId('motivo-do-ajuste'), 'correcao');
    await usuario.click(screen.getByTestId('confirmar-ajuste'));

    expect(await screen.findByText('Aluno não encontrado.')).toBeInTheDocument();
  });

  /* --- Categoria de placar (F35, ADR-049 Decisão 4) --------------------- */

  it('gera com a categoria escolhida, nao sempre XP', async () => {
    // O canário: se a tela não mandasse a categoria, o seletor seria
    // decorativo e toda geração viraria XP no servidor pelo default.
    vi.mocked(gerarPlacar).mockResolvedValue({
      snapshot: { id: 'snap-f', category: 'FREQUENCIA', status: 'DRAFT', publishedAt: null, entries: [] },
    });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.selectOptions(screen.getByTestId('categoria-do-placar'), 'FREQUENCIA');
    await usuario.click(screen.getByTestId('gerar-placar'));

    // A ULTIMA chamada, nao a primeira: nao ha `mockReset` entre os testes
    // deste arquivo, entao `calls[0]` seria o envio de um teste anterior --
    // e o teste passaria ou falharia pela ordem de execucao, nao pelo codigo.
    const chamadas = vi.mocked(gerarPlacar).mock.calls;
    const formulario = chamadas[chamadas.length - 1]?.[1] as FormData;
    expect(formulario.get('category')).toBe('FREQUENCIA');
  });

  it('o snapshot na tela diz QUAL placar e', async () => {
    // Três rascunhos do mesmo mês são indistinguíveis sem isto, e publicar
    // vira aposta.
    vi.mocked(gerarPlacar).mockResolvedValue({
      snapshot: { id: 'snap-c', category: 'CONSISTENCIA', status: 'DRAFT', publishedAt: null, entries: [] },
    });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByTestId('gerar-placar'));

    expect(await screen.findByTestId('categoria-do-snapshot')).toHaveTextContent(/consist/i);
  });

  it('o rotulo diz o que a categoria MEDE, nao o nome do enum', () => {
    // "CONSISTENCIA" não avisa que premia regularidade e não volume -- e
    // quem opera a recepção publicaria o placar errado para a parede.
    renderizar();

    const seletor = screen.getByTestId('categoria-do-placar');
    expect(seletor).toHaveTextContent(/semanas em que treinou/i);
    expect(seletor).toHaveTextContent(/total de treinos/i);
  });
});
