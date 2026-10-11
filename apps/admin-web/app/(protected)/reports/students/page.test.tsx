import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/students',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import PaginaDoRelatorioDeAlunos from './page';

const LINHA = {
  studentId: '11111111-1111-4111-8111-111111111111',
  deviceIds: ['1042', '1043'],
  fullName: 'Maria da Silva',
  cpf: '11144477735',
  phone: '41999990000',
  planLabel: 'Mensal Fit',
};
const SEM_NADA = {
  studentId: '22222222-2222-4222-8222-222222222222',
  deviceIds: [],
  fullName: 'Joao Sem Dados',
  cpf: null,
  phone: null,
  planLabel: null,
};

function responder(
  relatorio: unknown,
  extras: { unidades?: unknown[]; planos?: unknown[] | 'erro' } = {},
) {
  vi.mocked(chamarApi).mockImplementation(((caminho: string) => {
    if (caminho.startsWith('/api/v1/reports/students')) {
      return Promise.resolve({ ok: true, dados: relatorio, cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/units') {
      return Promise.resolve({ ok: true, dados: extras.unidades ?? [], cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/plans') {
      return extras.planos === 'erro'
        ? Promise.resolve({ ok: false, erro: { code: 'FORBIDDEN' }, cookiesDaApi: [] })
        : Promise.resolve({ ok: true, dados: extras.planos ?? [], cookiesDaApi: [] });
    }

    return Promise.resolve({ ok: true, dados: [], cookiesDaApi: [] });
  }) as never);
}

async function renderizar(searchParams: Record<string, string> = {}) {
  const elemento = await PaginaDoRelatorioDeAlunos({ searchParams: Promise.resolve(searchParams) });

  return render(elemento);
}

describe('Relatório de Alunos', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('mostra as cinco colunas, com CPF e contato mascarados e as catracas juntas', async () => {
    responder({ total: 1, linhas: [LINHA], proximoCursor: null });
    await renderizar();

    const tabela = screen.getByTestId('tabela-do-relatorio-de-alunos');

    for (const titulo of ['Catraca', 'Nome', 'CPF', 'Contato', 'Plano']) {
      expect(within(tabela).getByRole('columnheader', { name: titulo })).toBeTruthy();
    }
    expect(within(tabela).getByText('1042, 1043')).toBeTruthy();
    expect(within(tabela).getByText('Maria da Silva')).toBeTruthy();
    expect(within(tabela).getByText('111.444.777-35')).toBeTruthy();
    expect(within(tabela).getByText('Mensal Fit')).toBeTruthy();
  });

  it('aluno sem CPF, contato, plano e catraca mostra célula vazia, não "null"', async () => {
    responder({ total: 1, linhas: [SEM_NADA], proximoCursor: null });
    await renderizar();

    const tabela = screen.getByTestId('tabela-do-relatorio-de-alunos');

    expect(within(tabela).getByText('Joao Sem Dados')).toBeTruthy();
    expect(tabela.textContent).not.toMatch(/null|undefined/);
  });

  it('repassa o filtro da URL para a API (e só ele)', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'ACTIVE', financeiro: 'INADIMPLENTES', tenantId: 'outro' });

    const chamada = vi
      .mocked(chamarApi)
      .mock.calls.find(([c]) => String(c).startsWith('/api/v1/reports/students'));
    const consulta = new URLSearchParams(String(chamada?.[0]).split('?')[1]);

    expect(consulta.get('status')).toBe('ACTIVE');
    expect(consulta.get('financeiro')).toBe('INADIMPLENTES');
    expect(consulta.get('tenantId')).toBeNull();
    expect(consulta.get('limit')).toBe('20');
  });

  it('botões de exportação carregam os filtros atuais', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'BLOCKED', planId: 'p1' });

    const pdf = screen.getByRole('link', { name: /exportar pdf/i }).getAttribute('href') ?? '';
    const csv = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href') ?? '';

    expect(pdf).toBe('/reports/students/export?status=BLOCKED&planId=p1&format=pdf');
    expect(csv).toBe('/reports/students/export?status=BLOCKED&planId=p1&format=csv');
  });

  it('há próxima página: o link leva filtros e cursor', async () => {
    responder({ total: 50, linhas: [LINHA], proximoCursor: LINHA.studentId });
    await renderizar({ status: 'ACTIVE' });

    const proximo = screen.getByRole('link', { name: /próxim/i }).getAttribute('href') ?? '';

    expect(proximo).toBe(`/reports/students?status=ACTIVE&cursor=${LINHA.studentId}`);
  });

  it('lista vazia com filtro: mensagem de filtro, não "nenhum aluno cadastrado"', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'BLOCKED' });

    expect(screen.getByText('Nenhum aluno encontrado com esses filtros.')).toBeTruthy();
  });

  it('lista vazia sem filtro: diz que não há aluno', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar();

    expect(screen.getByText('Nenhum aluno cadastrado ainda.')).toBeTruthy();
  });

  it('sem plan.read (planos falham), a tela segue e o filtro de plano some', async () => {
    responder({ total: 1, linhas: [LINHA], proximoCursor: null }, { planos: 'erro' });
    await renderizar();

    expect(screen.getByTestId('tabela-do-relatorio-de-alunos')).toBeTruthy();
    expect(screen.queryByLabelText('Plano')).toBeNull();
  });

  it('API recusa (sem student.read): erro de permissão, sem tabela', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', status: 403, code: 'FORBIDDEN', correlationId: 'c' },
      cookiesDaApi: [],
    } as never);
    await renderizar();

    expect(screen.getByTestId('erro-de-permissao')).toBeTruthy();
    expect(screen.queryByTestId('tabela-do-relatorio-de-alunos')).toBeNull();
  });
});
