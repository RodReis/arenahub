import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/*
 * Mesmo motivo de `students/page.test.tsx`: o filtro por busca escreve na URL
 * pelo router do App Router, que não existe no jsdom. Estes testes olham a
 * TABELA, não o filtro.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/team',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeTime from './page';

const PROFESSOR = {
  id: '11111111-1111-4111-8111-111111111111',
  membershipNumber: 'AP-2026-00000010',
  fullName: 'Fernanda Costa',
  profile: 'TRAINER',
  gymUnitId: '99999999-9999-4999-8999-999999999999',
  employmentType: 'CLT',
  employmentStartedAt: '2024-01-10',
  version: 0,
  deviceIds: ['1042'],
};

const FUNCIONARIO_SEM_VINCULO = {
  id: '22222222-2222-4222-8222-222222222222',
  membershipNumber: 'AP-2026-00000011',
  fullName: 'Bruno Alves',
  profile: 'STAFF',
  gymUnitId: '99999999-9999-4999-8999-999999999999',
  employmentType: null,
  employmentStartedAt: null,
  version: 0,
  deviceIds: [],
};

function responder(membros: unknown[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) =>
    Promise.resolve(
      caminho.startsWith('/api/v1/team')
        ? { ok: true, dados: membros, cookiesDaApi: [] }
        : { ok: true, dados: [], cookiesDaApi: [] },
    ),
  );
}

async function renderizar(membros: unknown[]) {
  responder(membros);

  const elemento = await PaginaDeTime({ searchParams: Promise.resolve({}) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('grid de time', () => {
  it('mostra nome, perfil traduzido e vínculo', async () => {
    await renderizar([PROFESSOR]);

    expect(screen.getByText(PROFESSOR.fullName)).toBeInTheDocument();
    expect(screen.getByText('Professor')).toBeInTheDocument();
    expect(screen.getByText('CLT')).toBeInTheDocument();
  });

  it('mostra travessão quando não há vínculo definido', async () => {
    await renderizar([FUNCIONARIO_SEM_VINCULO]);

    expect(screen.getByText('Funcionário')).toBeInTheDocument();
    expect(screen.getByTestId(`vinculo-${FUNCIONARIO_SEM_VINCULO.id}`)).toHaveTextContent('—');
  });

  it('a linha leva para a ficha do membro', async () => {
    await renderizar([PROFESSOR]);

    const link = screen.getByRole('link', { name: PROFESSOR.fullName });
    expect(link).toHaveAttribute('href', `/team/${PROFESSOR.id}`);
  });
});
