import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { cadastrarAula, registrarExcecaoDeAula } from './classes';

const UNIDADE = '11111111-1111-4111-8111-111111111111';
const MODALIDADE = '22222222-2222-4222-8222-222222222222';
const PROFESSOR = '33333333-3333-4333-8333-333333333333';
const AULA = '44444444-4444-4444-8444-444444444444';

function formularioDeAula(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('gymUnitId', UNIDADE);
  dados.set('modalityId', MODALIDADE);
  dados.set('dayOfWeek', '2');
  dados.set('startMinute', '480');
  dados.set('durationMinutes', '60');
  dados.set('capacity', '20');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function aulaCriada() {
  return {
    ok: true,
    dados: { id: AULA, trainerId: PROFESSOR, capacity: 20, isActive: true },
    cookiesDaApi: [],
  };
}

describe('cadastrarAula', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('cadastra sem professor -- quadra alugada', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aulaCriada());

    const estado = await cadastrarAula({}, formularioDeAula());

    expect(estado.sucesso).toBeDefined();
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(`/api/v1/units/${UNIDADE}/classes`);
    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1] as { corpo: Record<string, unknown> };
    expect(corpo.corpo['trainerId']).toBeUndefined();
  });

  it('cadastra com professor', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aulaCriada());

    const estado = await cadastrarAula({}, formularioDeAula({ trainerId: PROFESSOR }));

    expect(estado.sucesso).toBeDefined();
    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1] as { corpo: Record<string, unknown> };
    expect(corpo.corpo['trainerId']).toBe(PROFESSOR);
  });

  it('preserva o preenchimento quando a validacao falha', async () => {
    const estado = await cadastrarAula({}, formularioDeAula({ capacity: '0' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.valores?.dayOfWeek).toBe('2');
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });

  it('traduz o erro de aula que atravessa a virada do dia', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'invalida',
        status: 422,
        code: 'CLASS_SCHEDULE_INVALID',
        correlationId: 'teste',
      },
      cookiesDaApi: [],
    });

    const estado = await cadastrarAula({}, formularioDeAula());

    expect(estado.erro).toContain('virada do dia');
  });
});

describe('registrarExcecaoDeAula', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('cancela uma ocorrencia', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { id: 'exc-1', classId: AULA, occurrenceDate: '2026-09-23', type: 'CANCELLED' },
      cookiesDaApi: [],
    });

    const dados = new FormData();
    dados.set('classId', AULA);
    dados.set('gymUnitId', UNIDADE);
    dados.set('occurrenceDate', '2026-09-23');
    dados.set('type', 'CANCELLED');

    const estado = await registrarExcecaoDeAula({}, dados);

    expect(estado.sucesso).toBeDefined();
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(
      `/api/v1/units/${UNIDADE}/classes/${AULA}/exceptions`,
    );
  });

  it('exige overrideTrainerId quando o tipo e TRAINER_OVERRIDE', async () => {
    const dados = new FormData();
    dados.set('classId', AULA);
    dados.set('gymUnitId', UNIDADE);
    dados.set('occurrenceDate', '2026-09-23');
    dados.set('type', 'TRAINER_OVERRIDE');

    const estado = await registrarExcecaoDeAula({}, dados);

    expect(estado.sucesso).toBeUndefined();
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });

  it('traduz o erro de excecao ja existente no dia', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'conflito',
        status: 409,
        code: 'CLASS_EXCEPTION_ALREADY_EXISTS',
        correlationId: 'teste',
      },
      cookiesDaApi: [],
    });

    const dados = new FormData();
    dados.set('classId', AULA);
    dados.set('gymUnitId', UNIDADE);
    dados.set('occurrenceDate', '2026-09-23');
    dados.set('type', 'CANCELLED');

    const estado = await registrarExcecaoDeAula({}, dados);

    expect(estado.erro).toContain('Já existe');
  });
});
