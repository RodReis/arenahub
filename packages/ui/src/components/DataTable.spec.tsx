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

  it('tinge so a linha que descreve estado (rowTom) e deixa as outras planas', () => {
    render(tabela({ rowTom: (linha) => (linha.id === '1' ? 'negativo' : undefined) }));

    expect(screen.getByText('Maria').closest('tr')).toHaveAttribute('data-tom', 'negativo');
    expect(screen.getByText('João').closest('tr')).not.toHaveAttribute('data-tom');
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

  /**
   * O TOTAL do filtro atual, quando a rota o informa -- "20 de 341".
   *
   * Sem ele a paginacao por cursor nao da nocao de escala: "20 itens
   * carregados" nao distingue uma base de 25 alunos de uma de 2.000.
   */
  it('mostra "N de TOTAL" quando o total e informado', () => {
    render(tabela({ nextHref: '/students?cursor=zzz', total: 341 }));

    expect(screen.getByText(/2 de 341/)).toBeInTheDocument();
    expect(screen.queryByText(/itens carregados/)).not.toBeInTheDocument();
  });

  /** Separador de milhar em pt-BR: "1.968", nunca "1,968" nem "1968". */
  it('formata o total com separador de milhar', () => {
    render(tabela({ nextHref: '/students?cursor=zzz', total: 1968 }));

    expect(screen.getByText(/2 de 1\.968/)).toBeInTheDocument();
  });

  /*
   * `undefined` e "a rota nao informa", que NAO e zero. Voltar ao texto
   * antigo e o comportamento certo: anunciar "de 0" numa base cheia seria
   * dizer que a academia nao tem aluno.
   */
  it('sem total informado, mantem o texto de itens carregados', () => {
    render(tabela({ nextHref: '/students?cursor=zzz' }));

    expect(screen.getByText(/2 itens carregados/)).toBeInTheDocument();
  });

  /*
   * O RODAPE APARECE SEM PAGINACAO quando ha total -- achado no E2E.
   *
   * O banco de teste tem 18 alunos, cabe numa pagina, e nao havia
   * "Proximos": o rodape inteiro nao renderizava e a contagem sumia
   * justamente na base pequena, que e onde a pessoa mais consegue conferir o
   * numero de cabeca.
   */
  it('mostra o total mesmo sem link de pagina nenhum', () => {
    render(tabela({ total: 18 }));

    expect(screen.getByText(/2 de 18/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Próximos' })).not.toBeInTheDocument();
  });

  /** Sem total E sem paginacao, o rodape nao existe -- nada a dizer. */
  it('sem total e sem paginação, não há rodapé', () => {
    render(tabela({}));

    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();
  });

  /*
   * Zero e um total LEGITIMO -- busca que nao achou ninguem. Tratar como
   * ausente aqui esconderia justamente a informacao que explica a tela vazia.
   */
  it('total zero e mostrado, nao tratado como ausente', () => {
    render(tabela({ nextHref: '/students?cursor=zzz', total: 0 }));

    expect(screen.getByText(/2 de 0/)).toBeInTheDocument();
  });

  /**
   * REGRESSAO: as 12 tabelas que este componente substitui carregam
   * `data-testid` que os 39 E2E ja procuram (`tabela-de-alunos`,
   * `tabela-de-unidades`, `tabela-de-direitos`). Sem repassar, a migracao
   * derruba a rede de seguranca que existe justamente para provar que ela nao
   * mudou comportamento.
   */
  it('repassa o testid da tabela', () => {
    render(tabela({ testId: 'tabela-de-alunos' }));

    expect(screen.getByTestId('tabela-de-alunos').tagName).toBe('TABLE');
  });

  /** Cada linha carrega o proprio testid -- `aluno-${id}` no E2E de alunos. */
  it('repassa o testid por linha', () => {
    render(tabela({ rowTestId: (linha) => `aluno-${linha.id}` }));

    expect(screen.getByTestId('aluno-1').tagName).toBe('TR');
    expect(screen.getByTestId('aluno-2')).toBeInTheDocument();
  });

  it('sem testid, nao poluí o DOM com atributo vazio', () => {
    const { container } = render(tabela());

    expect(container.querySelectorAll('[data-testid]').length).toBe(0);
  });

  it('coluna numerica liga numeral tabular', () => {
    const colunas: readonly Column<Linha>[] = [
      { key: 'id', header: 'Matrícula', numeric: true, render: (linha) => linha.id },
    ];
    const { container } = render(tabela({ columns: colunas }));

    expect(container.querySelectorAll('td[data-numeric]').length).toBe(2);
  });
});

/*
 * GRUPOS DE COLUNA -- emenda de 05/10/2026 (decisao do PI, DS-PAINEL §3.5b).
 * A grade de cobrancas junta colunas sob "Cobranca" e "Recebimento"; o
 * grupo e uma linha de cabecalho a mais, com `scope="colgroup"`, para o leitor
 * de tela anunciar a qual bloco a coluna pertence.
 */
describe('DataTable com grupos de coluna', () => {
  interface Fatura {
    readonly id: string;
    readonly mes: string;
    readonly valor: string;
    readonly forma: string;
  }

  const FATURAS: readonly Fatura[] = [{ id: 'f1', mes: 'nov/26', valor: 'R$ 150,00', forma: 'Dinheiro' }];

  const AGRUPADAS: readonly Column<Fatura>[] = [
    { key: 'mes', header: 'Competência', group: 'Cobrança', render: (f) => f.mes },
    { key: 'valor', header: 'Valor', group: 'Cobrança', render: (f) => f.valor },
    { key: 'forma', header: 'Forma', group: 'Recebimento', render: (f) => f.forma },
    { key: 'acao', header: 'Ação', role: 'actions', render: () => null },
  ];

  const montar = (colunas: readonly Column<Fatura>[]) =>
    render(
      <DataTable
        rows={FATURAS}
        columns={colunas}
        caption="Cobranças"
        rowKey={(f) => f.id}
        empty={<p>vazio</p>}
      />,
    );

  it('desenha uma linha de grupos com colSpan e scope="colgroup"', () => {
    montar(AGRUPADAS);

    const cobranca = screen.getByRole('columnheader', { name: 'Cobrança' });
    const recebimento = screen.getByRole('columnheader', { name: 'Recebimento' });

    expect(cobranca).toHaveAttribute('scope', 'colgroup');
    expect(cobranca).toHaveAttribute('colspan', '2');
    expect(recebimento).toHaveAttribute('colspan', '1');
    expect(document.querySelectorAll('thead tr')).toHaveLength(2);
  });

  it('marca a primeira coluna de cada grupo, no cabecalho e no corpo, para a divisoria', () => {
    montar(AGRUPADAS);

    const marcadas = [...document.querySelectorAll('tbody [data-inicio-de-grupo]')].map((c) => c.textContent);
    expect(marcadas).toEqual(['nov/26', 'Dinheiro']);
  });

  it('sem grupo declarado, a tabela continua com uma linha de cabecalho so', () => {
    montar(AGRUPADAS.map(({ group: _grupo, ...coluna }) => coluna));

    expect(document.querySelectorAll('thead tr')).toHaveLength(1);
    expect(document.querySelectorAll('[data-inicio-de-grupo]')).toHaveLength(0);
  });
});
