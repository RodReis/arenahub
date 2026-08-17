import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable, type Column } from './DataTable.js';

interface Linha {
  readonly id: string;
  readonly nome: string;
}

const LINHAS: readonly Linha[] = [
  { id: '1', nome: 'Maria' },
  { id: '2', nome: 'João' },
];

const COLUNAS: readonly Column<Linha>[] = [
  { key: 'nome', header: 'Nome', render: (linha) => linha.nome },
];

function tabela(extra: Partial<Parameters<typeof DataTable<Linha>>[0]> = {}) {
  return (
    <DataTable
      rows={LINHAS}
      columns={COLUNAS}
      caption="Alunos, do cadastro mais recente para o mais antigo"
      rowKey={(linha) => linha.id}
      empty={<p>Nenhum aluno</p>}
      {...extra}
    />
  );
}

describe('DataTable', () => {
  it('tem caption -- tabela sem legenda e opaca no leitor de tela', () => {
    render(tabela());

    expect(screen.getByRole('table')).toHaveAccessibleName(/Alunos/);
  });

  it('cabecalho usa scope=col', () => {
    render(tabela());

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('scope', 'col');
  });

  it('renderiza uma linha por item', () => {
    render(tabela());

    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('João')).toBeInTheDocument();
  });

  /** Lista vazia mostra a SAIDA, nao uma tabela de zero linhas. */
  it('lista vazia mostra o estado vazio no lugar da tabela', () => {
    render(tabela({ rows: [] }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum aluno')).toBeInTheDocument();
  });

  /**
   * Paginacao por CURSOR -- §5. Numero de pagina exigiria `COUNT(*)` a cada
   * consulta e mentiria: o total muda entre um clique e outro enquanto a
   * recepcao cadastra.
   */
  it('oferece Anteriores e Proximos, nunca numero de pagina', () => {
    render(tabela({ prevHref: '/students?cursor=aaa', nextHref: '/students?cursor=zzz' }));

    expect(screen.getByRole('link', { name: 'Anteriores' })).toHaveAttribute(
      'href',
      '/students?cursor=aaa',
    );
    expect(screen.getByRole('link', { name: 'Próximos' })).toHaveAttribute(
      'href',
      '/students?cursor=zzz',
    );
    expect(screen.queryByRole('link', { name: '2' })).not.toBeInTheDocument();
  });

  it('sem proxima pagina, nao inventa link morto', () => {
    render(tabela());

    expect(screen.queryByRole('link', { name: 'Próximos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Anteriores' })).not.toBeInTheDocument();
  });

  /**
   * O contador que o §5 pede junto de Anteriores/Proximos. Sem ele, quem
   * navega nao sabe quantos resultados ja viu.
   */
  it('mostra o contador de itens carregados', () => {
    render(tabela({ nextHref: '/students?cursor=zzz' }));

    expect(screen.getByText(/2 itens carregados/)).toBeInTheDocument();
  });

  it('coluna numerica liga numeral tabular', () => {
    const colunas: readonly Column<Linha>[] = [
      { key: 'id', header: 'Matrícula', numeric: true, render: (linha) => linha.id },
    ];
    const { container } = render(tabela({ columns: colunas }));

    expect(container.querySelectorAll('td[data-numeric]').length).toBe(2);
  });
});
