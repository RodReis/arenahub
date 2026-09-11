import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RowMenu, type ItemDeMenu } from './RowMenu.js';

/**
 * O jsdom nao implementa a Popover API.
 *
 * Sem estes dois dubles, `popoverTarget` nao abre nada e todo teste aqui
 * passaria por vacuidade -- o menu nunca apareceria, e `queryBy` confirmaria
 * felizmente que ele nao esta la. O que os testes afirmam e a ESTRUTURA do
 * menu (papeis, rotulos, separador, o que cada item dispara), nao o
 * comportamento da camada superior do navegador, que e dele.
 */
beforeAll(() => {
  if (HTMLElement.prototype.showPopover === undefined) {
    HTMLElement.prototype.showPopover = vi.fn();
    HTMLElement.prototype.hidePopover = vi.fn();
  }
});

const ITENS: readonly ItemDeMenu[] = [
  { id: 'editar', label: 'Editar cadastro', icon: 'pencil', href: '/platform/1' },
  { id: 'contratos', label: 'Contratos', icon: 'file-text', href: '/platform/1/contratos' },
  { id: 'inativar', label: 'Inativar cliente', icon: 'power', onSelect: vi.fn(), perigo: true },
];

describe('RowMenu', () => {
  it('o gatilho tem nome acessivel -- icone sozinho nao tem', () => {
    /*
     * Quem navega por audio ouviria "botao" e nada mais. O `aria-label`
     * carrega DE QUEM sao as acoes, porque a tabela tem uma linha por cliente.
     */
    render(<RowMenu label="Ações de Arena Positiva" itens={ITENS} testId="menu" />);

    expect(screen.getByTestId('menu')).toHaveAccessibleName('Ações de Arena Positiva');
  });

  it('cada item e um `menuitem`', () => {
    /*
     * `hidden: true` na consulta: o popover FECHADO conta como escondido, e a
     * consulta por papel ignora conteudo oculto por padrao. O jsdom nao abre
     * popover (a API nao existe la), entao exigir o menu aberto so mediria o
     * dublê. O que se afirma aqui e a estrutura -- ela e a mesma nos dois
     * estados.
     */
    render(<RowMenu label="Ações" itens={ITENS} />);

    expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(3);
  });

  it('item com `href` e LINK de verdade', () => {
    // Abrir em nova aba, copiar endereco e o anuncio de "link" do leitor de
    // tela nao se recuperam com JavaScript.
    render(<RowMenu label="Ações" itens={ITENS} />);

    expect(screen.getByTestId('menu-contratos')).toHaveAttribute(
      'href',
      '/platform/1/contratos',
    );
  });

  it('item destrutivo abre secao propria e veste o tom de perigo', () => {
    render(<RowMenu label="Ações" itens={ITENS} />);

    expect(screen.getByTestId('menu-inativar')).toHaveAttribute('data-perigo', 'true');
    expect(screen.getByRole('separator', { hidden: true })).toBeInTheDocument();
  });

  it('o item sem `href` dispara a acao e FECHA o menu antes dela', async () => {
    /*
     * A ordem importa: a acao costuma abrir um dialogo, e um popover aberto
     * por cima dele rouba o foco que o dialogo acabou de tomar.
     */
    const usuario = userEvent.setup();
    const acao = vi.fn();
    const fechar = vi.spyOn(HTMLElement.prototype, 'hidePopover');

    render(
      <RowMenu
        label="Ações"
        itens={[{ id: 'inativar', label: 'Inativar', icon: 'power', onSelect: acao }]}
      />,
    );

    await usuario.click(screen.getByTestId('menu-inativar'));

    expect(fechar).toHaveBeenCalled();
    expect(acao).toHaveBeenCalledOnce();
    expect(fechar.mock.invocationCallOrder[0]).toBeLessThan(acao.mock.invocationCallOrder[0] ?? 0);
  });

  it('sem item destrutivo NAO ha separador', () => {
    // Regua sozinha no fim de um menu de dois itens e ruido: ela marca uma
    // transicao que nao existe.
    render(<RowMenu label="Ações" itens={ITENS.slice(0, 2)} />);

    expect(screen.queryByRole('separator', { hidden: true })).not.toBeInTheDocument();
  });
});
