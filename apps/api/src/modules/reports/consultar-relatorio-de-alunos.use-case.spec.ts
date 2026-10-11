import { describe, expect, it, jest } from '@jest/globals';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  ConsultarRelatorioDeAlunosUseCase,
  LIMITE_MAXIMO_DA_PAGINA,
  TETO_DE_LINHAS_DA_EXPORTACAO,
} from './consultar-relatorio-de-alunos.use-case.js';
import { lerFiltro, type LinhaDoRelatorioDeAlunos } from './domain/filtro-do-relatorio-de-alunos.js';
import type { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

const CTX = { tenantId: 't' } as TenantContext;
const AGORA = new Date('2026-10-10T15:00:00.000Z');
const FILTRO = lerFiltro({});

const linha = (n: number): LinhaDoRelatorioDeAlunos => ({
  studentId: `id-${n}`,
  deviceIds: [],
  fullName: `Aluno ${n}`,
  cpf: null,
  phone: null,
  planLabel: null,
});

function repoFalso(total: number, linhas: LinhaDoRelatorioDeAlunos[] = []) {
  const contar = jest.fn(() => Promise.resolve(total));
  const listar = jest.fn((..._args: unknown[]) => Promise.resolve(linhas));

  return { repo: { contar, listar } as unknown as RelatorioDeAlunosRepository, contar, listar };
}

describe('ConsultarRelatorioDeAlunosUseCase.todos', () => {
  it('acima do teto: 422 REPORT_TOO_LARGE e NENHUMA linha é lida', async () => {
    const { repo, listar } = repoFalso(TETO_DE_LINHAS_DA_EXPORTACAO + 1);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const erro = await caso.todos(CTX, FILTRO, AGORA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect(erro).toMatchObject({ code: 'REPORT_TOO_LARGE', status: 422 });
    expect(listar).not.toHaveBeenCalled();
  });

  it('exatamente no teto passa', async () => {
    const { repo } = repoFalso(TETO_DE_LINHAS_DA_EXPORTACAO, [linha(1)]);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await expect(caso.todos(CTX, FILTRO, AGORA)).resolves.toMatchObject({
      total: TETO_DE_LINHAS_DA_EXPORTACAO,
    });
  });

  it('base vazia: devolve vazio sem consultar linhas', async () => {
    const { repo, listar } = repoFalso(0);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await expect(caso.todos(CTX, FILTRO, AGORA)).resolves.toEqual({ total: 0, linhas: [] });
    expect(listar).not.toHaveBeenCalled();
  });
});

describe('ConsultarRelatorioDeAlunosUseCase.pagina', () => {
  it('lê limite+1 para saber se há próxima e devolve só `limite` linhas', async () => {
    const tres = [linha(1), linha(2), linha(3)];
    const { repo, listar } = repoFalso(10, tres);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const pagina = await caso.pagina(CTX, FILTRO, { limite: 2 }, AGORA);

    expect(listar).toHaveBeenCalledWith(CTX, FILTRO, AGORA, { limite: 3, cursor: undefined });
    expect(pagina.linhas.map((l) => l.studentId)).toEqual(['id-1', 'id-2']);
    expect(pagina.proximoCursor).toBe('id-2');
    expect(pagina.total).toBe(10);
  });

  it('última página: sem próximo cursor', async () => {
    const { repo } = repoFalso(2, [linha(1), linha(2)]);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const pagina = await caso.pagina(CTX, FILTRO, { limite: 2 }, AGORA);

    expect(pagina.proximoCursor).toBeNull();
  });

  it('limite é travado em [1, 100]', async () => {
    const { repo, listar } = repoFalso(0);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await caso.pagina(CTX, FILTRO, { limite: 100_000 }, AGORA);
    await caso.pagina(CTX, FILTRO, { limite: -5 }, AGORA);

    expect(listar).toHaveBeenNthCalledWith(1, CTX, FILTRO, AGORA, {
      limite: LIMITE_MAXIMO_DA_PAGINA + 1,
      cursor: undefined,
    });
    expect(listar).toHaveBeenNthCalledWith(2, CTX, FILTRO, AGORA, { limite: 2, cursor: undefined });
  });
});
