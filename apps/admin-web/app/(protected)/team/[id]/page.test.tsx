import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('../../../actions/team', () => ({
  alterarPerfilDeTime: vi.fn(),
  atualizarVinculo: vi.fn(),
}));

vi.mock('../../../actions/students', () => ({
  editarAluno: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import PaginaDaFichaDeTime from './page';

const MEMBRO_ID = '22222222-2222-4222-8222-222222222222';

const MEMBRO = {
  id: MEMBRO_ID,
  membershipNumber: 'AP-2026-00001491',
  fullName: 'RODRIGO REIS BARROS',
  profile: 'TRAINER',
  gymUnitId: 'unidade-1',
  employmentType: null,
  employmentStartedAt: null,
  version: 1,
};

function cadastro(sobrescritas: Record<string, unknown> = {}) {
  return {
    ...MEMBRO,
    birthDate: '1978-10-06',
    cpf: '85790672191',
    status: 'ACTIVE',
    statusReason: null,
    statusReasonNote: null,
    archivedAt: null,
    rg: null,
    registeredSex: null,
    contacts: [{ type: 'PHONE', value: '11999998888', isPrimary: true, label: null, relationship: null }],
    address: null,
    ...sobrescritas,
  };
}

function responder(cadastroDoMembro: object | null) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.endsWith('/agenda')) {
      return Promise.resolve({ ok: true, dados: [], cookiesDaApi: [] });
    }
    if (caminho.startsWith('/api/v1/students/')) {
      return Promise.resolve(
        cadastroDoMembro === null
          ? {
              ok: false,
              erro: { type: 'about:blank', title: 'Proibido', status: 403, code: 'FORBIDDEN', correlationId: 'c' },
              cookiesDaApi: [],
            }
          : { ok: true, dados: cadastroDoMembro, cookiesDaApi: [] },
      );
    }
    return Promise.resolve({ ok: true, dados: MEMBRO, cookiesDaApi: [] });
  });
}

async function renderizar() {
  const elemento = await PaginaDaFichaDeTime({ params: Promise.resolve({ id: MEMBRO_ID }) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('ficha do membro do time', () => {
  it('mostra a identificacao do professor e o botao de editar cadastro, como na ficha do aluno', async () => {
    responder(cadastro());

    await renderizar();

    expect(screen.getByText('85790672191')).toBeTruthy();
    expect(screen.getByText('06/10/1978')).toBeTruthy();
    expect(screen.getByTestId('telefone-do-membro')).toBeTruthy();
    expect(screen.getByTestId(`abrir-edicao-${MEMBRO_ID}`)).toBeTruthy();
  });

  it('professor sem CPF mostra "não informado" e o campo de CPF fica editavel', async () => {
    responder(cadastro({ cpf: null, birthDate: '1900-01-01' }));

    await renderizar();

    expect(screen.getByText('não informado')).toBeTruthy();
    expect(screen.getByTestId('campo-edicao-cpf')).toBeTruthy();
  });

  it('sem permissao para ler o cadastro, avisa em vez de esconder a secao calada', async () => {
    responder(null);

    await renderizar();

    expect(screen.getByTestId('cadastro-indisponivel')).toBeTruthy();
    expect(screen.queryByTestId(`abrir-edicao-${MEMBRO_ID}`)).toBeNull();
    expect(screen.getByTestId('matricula')).toBeTruthy();
  });
});
