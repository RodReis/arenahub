import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ToastProvider } from './Toast.js';
import { useToastDeErro } from './useToastDeErro.js';

/**
 * Simula o ciclo do `useActionState`: a mensagem chega como VALOR novo no
 * estado, nunca como evento -- que e a razao de o hook existir.
 */
function Tela({ mensagens }: { readonly mensagens: readonly (string | undefined)[] }) {
  const [indice, setIndice] = useState(0);

  useToastDeErro(mensagens[indice], 'error', 'erro-da-tela');

  return (
    <button type="button" onClick={() => setIndice((i) => i + 1)}>
      reenviar
    </button>
  );
}

function montar(mensagens: readonly (string | undefined)[]) {
  return render(
    <ToastProvider>
      <Tela mensagens={mensagens} />
    </ToastProvider>,
  );
}

describe('useToastDeErro', () => {
  it('nao dispara toast sem mensagem', () => {
    montar([undefined]);

    expect(screen.queryByTestId('erro-da-tela')).not.toBeInTheDocument();
  });

  it('dispara o toast quando a mensagem chega', async () => {
    montar(['Falha ao salvar']);

    expect(await screen.findByTestId('erro-da-tela')).toHaveTextContent('Falha ao salvar');
  });

  /**
   * O RENDER SOZINHO NAO PODE EMPILHAR TOASTS.
   *
   * `useActionState` re-renderiza a tela varias vezes com o MESMO erro (foco,
   * digitacao noutro campo, `useFormStatus` mudando). Sem a comparacao por
   * mensagem, cada render viraria um toast novo e a tela encheria de copias.
   */
  it('nao repete o toast quando a mesma mensagem persiste entre renders', async () => {
    montar(['Falha ao salvar', 'Falha ao salvar']);

    await screen.findByTestId('erro-da-tela');
    await userEvent.click(screen.getByRole('button', { name: 'reenviar' }));

    expect(screen.getAllByTestId('erro-da-tela')).toHaveLength(1);
  });

  /**
   * ERRO DIFERENTE AVISA DE NOVO -- senao a segunda falha passaria em
   * silencio e a pessoa ficaria com a mensagem errada na tela.
   */
  it('dispara de novo quando a mensagem muda', async () => {
    montar(['Falha ao salvar', 'Sem permissao']);

    await screen.findByTestId('erro-da-tela');
    await userEvent.click(screen.getByRole('button', { name: 'reenviar' }));

    expect(await screen.findByText('Sem permissao')).toBeInTheDocument();
  });

  /**
   * O MESMO erro DEPOIS DE UM SUCESSO tem de avisar outra vez: a pessoa
   * clicou, algo aconteceu, e uma tela muda parece um botao quebrado.
   */
  it('avisa de novo quando o mesmo erro volta depois de sumir', async () => {
    montar(['Falha ao salvar', undefined, 'Falha ao salvar']);

    await screen.findByTestId('erro-da-tela');
    await userEvent.click(screen.getByRole('button', { name: 'reenviar' }));
    await userEvent.click(screen.getByRole('button', { name: 'reenviar' }));

    /*
     * DOIS toasts, e nao um: o toast nao expira sozinho -- ele fica ate ser
     * dispensado, porque uma falha que some antes de a recepcao olhar nao
     * avisou ninguem. O segundo aviso e a prova de que o hook nao engoliu a
     * repeticao depois do estado limpar.
     */
    expect(await screen.findAllByText('Falha ao salvar')).toHaveLength(2);
  });
});
