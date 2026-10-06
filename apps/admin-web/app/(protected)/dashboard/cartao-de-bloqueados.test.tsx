import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ConteudoDeBloqueados, type SituacaoDoDashboard } from './cartao-de-bloqueados';

/**
 * Aba "Bloqueados e suspensos" -- emenda de 05/10/2026 (pedido do PI: "mais
 * destaque, cores, efeitos"). Cada situacao virou um BLOCO tingido pelo tom
 * do estado -- bloqueado em `danger`, suspenso em `warning` -- com a contagem
 * grande e as pessoas como chips com iniciais.
 */
const SITUACOES: SituacaoDoDashboard[] = [
  { status: 'BLOCKED', motivo: 'DELINQUENCY', quantidade: 7, alunos: ['Maria Clara Souza', 'Joana Lima'] },
  { status: 'SUSPENDED', motivo: null, quantidade: 1, alunos: ['Lucas Teixeira Alves'] },
];

describe('ConteudoDeBloqueados', () => {
  it('um bloco por situacao, no tom do estado, com a contagem escrita', () => {
    render(<ConteudoDeBloqueados situacoes={SITUACOES} timeZone="America/Sao_Paulo" />);

    const blocos = screen.getAllByTestId('bloco-de-situacao');
    expect(blocos).toHaveLength(2);

    expect(blocos[0]).toHaveAttribute('data-tom', 'danger');
    expect(blocos[0]).toHaveTextContent('Bloqueado');
    expect(blocos[0]).toHaveTextContent('Inadimplência');
    expect(within(blocos[0]!).getByTestId('contagem-da-situacao')).toHaveTextContent('7');

    expect(blocos[1]).toHaveAttribute('data-tom', 'warning');
    expect(blocos[1]).toHaveTextContent('Suspenso');
    expect(blocos[1]).toHaveTextContent('Motivo não informado');
  });

  it('as pessoas viram chips com iniciais, e o resto vira "+N"', () => {
    render(<ConteudoDeBloqueados situacoes={SITUACOES} timeZone="America/Sao_Paulo" />);

    const [bloqueados] = screen.getAllByTestId('bloco-de-situacao');
    const pessoas = within(bloqueados!).getAllByRole('listitem');

    expect(pessoas.map((p) => p.textContent)).toEqual(['MCMaria Clara', 'JLJoana Lima', '+5']);
    // As iniciais sao decoracao: o leitor de tela ouve o nome, nao "M C".
    expect(within(pessoas[0]!).getByText('MC')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sem ninguem travado, a boa noticia continua dita por escrito', () => {
    render(<ConteudoDeBloqueados situacoes={[]} timeZone="America/Sao_Paulo" />);

    expect(screen.getByText(/Ninguém bloqueado ou suspenso/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('bloco-de-situacao')).toHaveLength(0);
  });
});
