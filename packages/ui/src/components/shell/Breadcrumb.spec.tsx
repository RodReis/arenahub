import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from './Breadcrumb.js';

describe('Breadcrumb', () => {
  it('renderiza cada migalha como link, menos a ultima', () => {
    render(
      <Breadcrumb
        trilha={[
          { rotulo: 'Alunos', href: '/students' },
          { rotulo: 'Fulano', href: '/students/1' },
          { rotulo: 'Evolução corporal' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Alunos' })).toHaveAttribute('href', '/students');
    expect(screen.getByRole('link', { name: 'Fulano' })).toHaveAttribute('href', '/students/1');
    expect(screen.queryByRole('link', { name: 'Evolução corporal' })).not.toBeInTheDocument();
  });

  it('marca a ultima migalha como pagina atual', () => {
    render(<Breadcrumb trilha={[{ rotulo: 'Alunos', href: '/students' }, { rotulo: 'Fulano' }]} />);

    expect(screen.getByText('Fulano')).toHaveAttribute('aria-current', 'page');
  });

  it('tem nome acessivel de navegacao', () => {
    render(<Breadcrumb trilha={[{ rotulo: 'Alunos' }]} />);

    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument();
  });

  it('migalha unica ainda funciona -- pagina de topo sem trilha', () => {
    render(<Breadcrumb trilha={[{ rotulo: 'Time' }]} />);

    expect(screen.getByText('Time')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
