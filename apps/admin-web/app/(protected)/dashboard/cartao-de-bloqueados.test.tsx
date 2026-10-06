import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ConteudoDeBloqueados, type SituacaoDoDashboard } from './cartao-de-bloqueados';

/**
 * Aba "Restrições e recusas" -- cada pessoa com o cadastro travado é um
 * cartão no molde do cartão de recusa (pedido do PI, 06/10/2026): faixa no
 * tom do estado, foto, nome e o MOTIVO escrito no rodapé.
 */
const MARIA = { id: 'a-1', nome: 'Maria Clara Souza', temFoto: true, nota: 'Chamou o instrutor de nomes' };
const JOANA = { id: 'a-2', nome: 'Joana Lima', temFoto: false, nota: null };
const LUCAS = { id: 'a-3', nome: 'Lucas Teixeira Alves', temFoto: false, nota: null };

const SITUACOES: SituacaoDoDashboard[] = [
  { status: 'BLOCKED', motivo: 'CONDUCT', quantidade: 7, alunos: [MARIA, JOANA] },
  { status: 'SUSPENDED', motivo: null, quantidade: 1, alunos: [LUCAS] },
];

function renderizar(situacoes: SituacaoDoDashboard[] = SITUACOES) {
  return render(<ConteudoDeBloqueados situacoes={situacoes} timeZone="America/Sao_Paulo" />);
}

describe('ConteudoDeBloqueados', () => {
  it('uma pessoa por cartão, no tom do estado, com a situação na faixa', () => {
    renderizar();

    const cartoes = screen.getAllByTestId('cartao-de-restricao');
    expect(cartoes).toHaveLength(3);

    expect(cartoes[0]).toHaveAttribute('data-tom', 'danger');
    expect(cartoes[0]).toHaveTextContent('Bloqueado');
    expect(cartoes[2]).toHaveAttribute('data-tom', 'warning');
    expect(cartoes[2]).toHaveTextContent('Suspenso');
  });

  it('o motivo vem escrito no rodapé, com a observação ao lado', () => {
    renderizar();

    const [maria] = screen.getAllByTestId('cartao-de-restricao');

    expect(within(maria!).getByText('Motivo')).toBeInTheDocument();
    expect(within(maria!).getByText('Conduta')).toBeInTheDocument();
    expect(within(maria!).getByText('Chamou o instrutor de nomes')).toBeInTheDocument();
  });

  it('sem motivo gravado, diz isso por escrito e aponta a ficha', () => {
    renderizar();

    const lucas = screen.getAllByTestId('cartao-de-restricao')[2]!;

    expect(within(lucas).getByText('Sem motivo registrado')).toBeInTheDocument();
    expect(within(lucas).getByText(/Informar na ficha/)).toBeInTheDocument();
    // O texto antigo, que não dizia o que fazer, saiu.
    expect(lucas).not.toHaveTextContent('Motivo não informado');
  });

  it('foto quando há, iniciais quando não; nome e foto levam à ficha', () => {
    renderizar();

    const [maria, joana] = screen.getAllByTestId('cartao-de-restricao');

    expect(maria!.querySelector('img')).toHaveAttribute('src', '/fotos-de-aluno/a-1');
    expect(joana!.querySelector('img')).toBeNull();
    expect(within(joana!).getByText('JL')).toBeInTheDocument();
    expect(within(joana!).getByRole('link', { name: 'Joana Lima' })).toHaveAttribute(
      'href',
      '/students/a-2',
    );
  });

  it('o que passa do teto vira um "+N" por STATUS que abre a grid da unidade, para a soma bater', () => {
    render(
      <ConteudoDeBloqueados
        situacoes={SITUACOES}
        gymUnitId="u-9"
        timeZone="America/Sao_Paulo"
      />,
    );

    // 7 bloqueados, 2 mostrados: faltam 5. O suspenso está inteiro, sem "+N".
    const mais = screen.getByRole('link', { name: /\+5/ });

    expect(mais).toHaveAttribute('href', '/students?status=BLOCKED&gymUnitId=u-9');
    expect(mais).toHaveTextContent('bloqueados');
    expect(screen.queryByRole('link', { name: /suspensos/ })).toBeNull();
    expect(screen.getByTestId('contagem-de-restritos')).toHaveTextContent('8 pessoas');
  });

  it('dois motivos no mesmo status somam num "+N" só, que é o que a grid filtra', () => {
    renderizar([
      { status: 'BLOCKED', motivo: 'CONDUCT', quantidade: 4, alunos: [MARIA] },
      { status: 'BLOCKED', motivo: 'DELINQUENCY', quantidade: 3, alunos: [JOANA] },
    ]);

    const mais = screen.getAllByRole('link', { name: /^\+\d/ });

    expect(mais).toHaveLength(1);
    expect(mais[0]).toHaveTextContent('+5');
  });

  it('os dois grupos têm título próprio, e o de recusa não se confunde com o de cadastro', () => {
    render(
      <ConteudoDeBloqueados situacoes={SITUACOES} recusados={[]} timeZone="America/Sao_Paulo" />,
    );

    expect(screen.getByRole('heading', { name: /Cadastro travado/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Barrados na catraca hoje/ })).toBeInTheDocument();
  });

  it('sem ninguém travado, a boa notícia continua dita por escrito', () => {
    renderizar([]);

    expect(screen.getByText(/Ninguém bloqueado ou suspenso/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('cartao-de-restricao')).toHaveLength(0);
  });
});
