import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rotaAtual = vi.fn(() => '/students');

vi.mock('next/navigation', () => ({
  usePathname: () => rotaAtual(),
}));

import { Navegacao } from './navegacao';

const ITENS = [
  { href: '/operations', label: 'Operação' },
  { href: '/students', label: 'Alunos' },
  { href: '/billing/delinquency', label: 'Cobrança', grupo: 'Financeiro' },
  { href: '/billing/reconciliation', label: 'Conciliação' },
  { href: '/billing', label: 'Painel financeiro', exigePermissao: 'billing.dashboard' },
  { href: '/operations/devices', label: 'Dispositivos', grupo: 'Administração' },
  { href: '/units', label: 'Unidades' },
] as const;

/** Os rótulos de grupo, na ordem em que aparecem no DOM. */
function rotulosVisiveis(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
}

describe('navegação principal', () => {
  it('mostra os dois grupos, na ordem da lista', () => {
    render(<Navegacao itens={ITENS} />);

    expect(rotulosVisiveis()).toEqual(['Financeiro', 'Administração']);
  });

  /*
   * O rótulo é `<h2>` e não `<span>` estilizado: quem navega por cabeçalho no
   * leitor de tela pula direto à seção. Um `<span>` com aparência de título
   * ficaria invisível para essa navegação.
   */
  it('publica o rótulo como cabeçalho de nível 2', () => {
    render(<Navegacao itens={ITENS} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Financeiro' })).toBeInTheDocument();
  });

  /*
   * O componente RENDERIZA o rótulo onde o campo estiver -- ele não adivinha
   * grupo. Quem garante que o campo sobrevive ao filtro de permissão é o
   * layout (`reancorarGrupos`), porque só lá a lista completa existe: depois
   * do filtro, a informação do item removido já não chega aqui.
   */
  it('renderiza o rótulo onde o campo estiver, e só ali', () => {
    const reancorado = [
      { href: '/billing/reconciliation', label: 'Conciliação', grupo: 'Financeiro' },
      { href: '/billing', label: 'Painel financeiro' },
    ] as const;

    render(<Navegacao itens={reancorado} />);

    expect(rotulosVisiveis()).toEqual(['Financeiro']);
  });

  it('não inventa rótulo quando nenhum item declara grupo', () => {
    const semGrupos = ITENS.filter((item) => !('grupo' in item));

    render(<Navegacao itens={semGrupos} />);

    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });

  describe('item atual', () => {
    it('marca um só item, o mais específico', () => {
      rotaAtual.mockReturnValue('/operations/devices');
      render(<Navegacao itens={ITENS} />);

      const marcados = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');

      expect(marcados).toHaveLength(1);
      expect(marcados[0]).toHaveTextContent('Dispositivos');
    });

    /*
     * A ficha do aluno é `/students/<id>` e precisa acender "Alunos": sidebar
     * que apaga ao abrir um registro tira a única âncora de lugar da tela.
     */
    it('acende o item pai numa rota de detalhe', () => {
      rotaAtual.mockReturnValue('/students/abc-123');
      render(<Navegacao itens={ITENS} />);

      expect(screen.getByRole('link', { name: 'Alunos' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    /* `/access-events` não pode acender `/access` por acaso de string. */
    it('não acende por prefixo parcial de palavra', () => {
      rotaAtual.mockReturnValue('/billing/reconciliation');
      render(<Navegacao itens={ITENS} />);

      expect(screen.getByRole('link', { name: 'Painel financeiro' })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: 'Conciliação' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  });

  /*
   * O rótulo NÃO é um link. Um cabeçalho que parece item de menu e não navega
   * é a pior espécie de elemento: a recepção clica e nada acontece.
   */
  it('rótulo de grupo não é clicável', () => {
    render(<Navegacao itens={ITENS} />);

    const financeiro = screen.getByRole('heading', { level: 2, name: 'Financeiro' });

    expect(within(financeiro).queryByRole('link')).toBeNull();
    expect(financeiro.closest('a')).toBeNull();
  });
});
