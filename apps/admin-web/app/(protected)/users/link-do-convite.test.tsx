import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { LinkDoConvite } from './link-do-convite';

const CAMINHO = '/convite/6j2iHNoK1WyFeDpeYivJaT1nOJ9NqVgGfKQzTSAaNzg';

function renderizar() {
  return render(
    <ToastProvider>
      <LinkDoConvite caminho={CAMINHO} />
    </ToastProvider>,
  );
}

/**
 * O `navigator.clipboard` NÃO EXISTE no jsdom e é somente-leitura no objeto
 * real -- daí `Object.defineProperty` em vez de atribuição. Cada teste
 * instala o seu, e o `afterEach` desfaz: dublê com estado vaza entre testes,
 * e um "copiou" de um caso passaria o seguinte pelo motivo errado.
 *
 * ⚠️ A ORDEM IMPORTA: `userEvent.setup()` instala o PRÓPRIO stub de
 * clipboard, então instalar antes dele não adianta -- o dublê é
 * sobrescrito, `writeText` nunca é chamado e o teste falha dizendo
 * "Number of calls: 0", que aponta para o componente e não para o teste.
 * Sempre `setup()` primeiro, dublê depois.
 */
function instalarClipboard(writeText: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

describe('link do convite', () => {
  afterEach(() => {
    instalarClipboard(undefined);
  });

  /**
   * O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR (issue #276).
   *
   * O link nascia como o CAMINHO relativo (`/convite/TOKEN`) dentro de um
   * `<p>`. Colar isso no WhatsApp não vira link, e quem recebe teria de saber
   * o domínio do painel para montar o endereço à mão. O PI viu na tela: "não
   * dá para fazer nada com esse link?".
   */
  it('mostra a URL completa, com o dominio pelo qual a pessoa chegou', async () => {
    renderizar();

    await waitFor(() => {
      expect(screen.getByTestId('link-do-convite')).toHaveTextContent(
        `${window.location.origin}${CAMINHO}`,
      );
    });
  });

  /**
   * O `href` FICA RELATIVO de propósito, mesmo com o texto absoluto: o
   * navegador já resolve contra a origem atual, e um `href` montado no
   * cliente apontaria para lugar nenhum durante o primeiro render (antes do
   * efeito), quando `origem` ainda está vazia.
   */
  it('e um link de verdade, que abre em nova aba com rel seguro', () => {
    renderizar();

    const link = screen.getByTestId('link-do-convite');

    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', CAMINHO);
    expect(link).toHaveAttribute('target', '_blank');
    // `noopener` impede que a aba aberta navegue esta; `noreferrer` evita
    // mandar a URL com o token no cabecalho `Referer`.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('copia a URL completa, e nao o caminho', async () => {
    const usuario = userEvent.setup();
    const escrever = vi.fn().mockResolvedValue(undefined);
    instalarClipboard(escrever);

    renderizar();

    await usuario.click(screen.getByTestId('copiar-link-do-convite'));

    await waitFor(() => {
      expect(escrever).toHaveBeenCalledWith(`${window.location.origin}${CAMINHO}`);
    });
  });

  /**
   * `navigator.clipboard` é OPCIONAL -- exige contexto seguro (HTTPS ou
   * localhost) e pode ser negado pela política do navegador. Sem a guarda, um
   * `TypeError` subiria da promessa e o clique não faria nada NEM DIRIA POR
   * QUÊ: a pessoa concluiria que copiou e colaria o convite anterior.
   */
  it('avisa quando o navegador nao oferece a area de transferencia', async () => {
    const usuario = userEvent.setup();
    instalarClipboard(undefined);

    renderizar();

    await usuario.click(screen.getByTestId('copiar-link-do-convite'));

    // A frase é PRÓPRIA deste caso: a do `catch` diz "Não foi possível
    // copiar". Se as duas fossem iguais, este teste passaria com a guarda
    // removida -- `undefined.writeText` cai no `catch` e mostra a outra.
    expect(
      await screen.findByText(/Seu navegador não oferece a área de transferência/),
    ).toBeInTheDocument();
  });

  /** Recusa do usuário no diálogo de permissão: a promessa rejeita. */
  it('avisa quando copiar e recusado', async () => {
    const usuario = userEvent.setup();
    instalarClipboard(vi.fn().mockRejectedValue(new Error('negado')));

    renderizar();

    await usuario.click(screen.getByTestId('copiar-link-do-convite'));

    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
  });

  /**
   * O CONVITE É DE USO ÚNICO -- `aceitar` marca `ACCEPTED` na mesma transação
   * que cria o usuário. Um link clicável sem este aviso convida quem quer "só
   * conferir" a queimar o convite da outra pessoa, e a saída seria convidar
   * de novo.
   */
  it('avisa que abrir e definir senha gasta o convite', () => {
    renderizar();

    expect(screen.getByText(/vale uma vez só/)).toBeInTheDocument();
  });
});
