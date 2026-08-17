import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.js';
import { NavLink } from './NavLink.js';
import { PageHeader } from './PageHeader.js';
import { ElevatedSessionBanner } from '../ElevatedSessionBanner.js';

function shell(extra: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return (
    <AppShell
      unitSelector={<span>Unidade Matriz</span>}
      user={<span>dono@arena.test</span>}
      nav={
        <>
          <NavLink href="/operations" label="Operação" current />
          <NavLink href="/students" label="Alunos" />
        </>
      }
      {...extra}
    >
      <p>conteúdo</p>
    </AppShell>
  );
}

describe('AppShell', () => {
  /**
   * O §5 nomeia a troca de unidade despercebida como "o erro operacional mais
   * caro do painel". Hoje nenhuma tela diz em qual unidade se esta.
   */
  it('mostra a unidade no topbar, em qualquer tela', () => {
    render(shell());

    expect(screen.getByText('Unidade Matriz')).toBeInTheDocument();
  });

  it('tem regiao principal e navegacao nomeada', () => {
    render(shell());

    expect(screen.getByRole('main')).toHaveTextContent('conteúdo');
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });

  /**
   * Sem skip link, toda navegacao de rota reobriga quem usa teclado a tabular
   * os sete links da sidebar antes de chegar ao conteudo.
   */
  it('oferece skip link apontando para o conteudo', () => {
    render(shell());

    const pular = screen.getByRole('link', { name: 'Pular para o conteúdo' });

    expect(pular).toHaveAttribute('href', '#conteudo-principal');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'conteudo-principal');
  });

  it('o banner so aparece quando ha sessao elevada', () => {
    const { rerender } = render(shell());
    expect(screen.queryByText(/Sessão elevada/)).not.toBeInTheDocument();

    rerender(
      shell({
        banner: (
          <ElevatedSessionBanner
            tenant="Arena Positiva"
            reason="Suporte ao chamado 4821"
            expiresAt="2026-08-16T17:32:00Z"
            timeZone="America/Sao_Paulo"
          />
        ),
      }),
    );

    expect(screen.getByText(/Sessão elevada/)).toBeInTheDocument();
    expect(screen.getByText(/14:32/)).toBeInTheDocument();
  });

  /**
   * Sessao elevada NAO tem como fechar -- a ausencia de `onDismiss` e a
   * garantia. Banner que se fecha some da memoria em trinta segundos.
   */
  it('o banner de sessao elevada nao oferece como fechar', () => {
    render(
      <ElevatedSessionBanner
        tenant="Arena Positiva"
        reason="Suporte"
        expiresAt="2026-08-16T17:32:00Z"
        timeZone="America/Sao_Paulo"
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('NavLink', () => {
  /**
   * Sem `aria-current`, quem usa leitor de tela ouve sete links identicos em
   * toda tela e nunca sabe onde esta.
   */
  it('marca a pagina atual para o leitor de tela', () => {
    render(shell());

    expect(screen.getByRole('link', { name: 'Operação' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Alunos' })).not.toHaveAttribute('aria-current');
  });
});

describe('PageHeader', () => {
  it('preserva o id que a section ja referencia por aria-labelledby', () => {
    render(<PageHeader title="Alunos" id="titulo-alunos" />);

    expect(screen.getByRole('heading', { name: 'Alunos' })).toHaveAttribute('id', 'titulo-alunos');
  });

  it('as acoes primarias sao opcionais', () => {
    const { rerender } = render(<PageHeader title="Alunos" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<PageHeader title="Alunos" actions={<a href="/students/novo">Cadastrar</a>} />);
    expect(screen.getByRole('link', { name: 'Cadastrar' })).toBeInTheDocument();
  });
});
