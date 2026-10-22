import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { salvarFicha, type DadosDaFicha } from './avaliacao-fisica';

const ALUNO = '11111111-1111-4111-8111-111111111111';
const RASCUNHO = '33333333-3333-4333-8333-333333333333';

const VAZIA = {
  pesoKg: null,
  estaturaCm: null,
  cinturaCm: null,
  quadrilCm: null,
  gorduraPct: null,
  pas: null,
  pad: null,
  fcRepouso: null,
  vo2max: null,
};

function ficha(extras: Partial<DadosDaFicha> = {}): DadosDaFicha {
  return {
    studentId: ALUNO,
    assessedOn: '2026-10-22',
    publicar: false,
    entradas: {
      ...VAZIA,
      pesoKg: 100,
      gorduraPct: 20,
      cinturaCm: 90,
      quadrilCm: 100,
      pas: 120,
      pad: 80,
      fcRepouso: 60,
      vo2max: 40,
    },
    ...extras,
  };
}

function corpoDa(chamada: number): { measurements: { type: string; value: number }[] } & Record<string, unknown> {
  return vi.mocked(chamarApi).mock.calls[chamada]?.[1]?.corpo as never;
}

beforeEach(() => {
  vi.mocked(chamarApi).mockReset();
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: { id: RASCUNHO }, cookiesDaApi: [] });
});

describe('salvarFicha', () => {
  it('cria o rascunho com as medidas digitadas e os calculados que o histórico lê', async () => {
    const resultado = await salvarFicha(ficha());

    expect(resultado).toEqual({ ok: true, assessmentId: RASCUNHO, publicada: false });
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(`/api/v1/students/${ALUNO}/assessments`);

    const corpo = corpoDa(0);
    const porTipo = Object.fromEntries(corpo.measurements.map((m) => [m.type, m.value]));

    // MG = 100 × 20% e MLG = 100 − 20, como no exemplo da folha; RCQ 90/100.
    expect(porTipo).toMatchObject({
      WEIGHT: 100,
      BODY_FAT_PERCENT: 20,
      BODY_FAT_MASS: 20,
      LEAN_BODY_MASS: 80,
      WAIST_HIP_RATIO: 0.9,
      BLOOD_PRESSURE_SYSTOLIC: 120,
      BLOOD_PRESSURE_DIASTOLIC: 80,
      HEART_RATE: 60,
      VO2_MAX: 40,
    });
    // Meio-dia UTC: a data do professor no fuso de qualquer unidade do Brasil.
    expect(corpo['assessedAt']).toBe('2026-10-22T12:00:00.000Z');
  });

  it('não envia medida vazia nem calculado sem operando', async () => {
    await salvarFicha(ficha({ entradas: { ...VAZIA, pesoKg: 80 } }));

    expect(corpoDa(0).measurements).toEqual([{ type: 'WEIGHT', value: 80, unit: 'kg' }]);
  });

  it('rascunho existente é editado, não duplicado', async () => {
    await salvarFicha(ficha({ assessmentId: RASCUNHO }));

    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(`/api/v1/assessments/${RASCUNHO}/draft`);
    expect(vi.mocked(chamarApi).mock.calls[0]?.[1]?.metodo).toBe('PATCH');
  });

  it('publicar salva e depois publica o mesmo id', async () => {
    const resultado = await salvarFicha(ficha({ publicar: true }));

    expect(vi.mocked(chamarApi).mock.calls[1]?.[0]).toBe(`/api/v1/assessments/${RASCUNHO}/publish`);
    expect(resultado).toMatchObject({ ok: true, publicada: true });
  });

  it('falha ao publicar avisa que o rascunho ficou salvo', async () => {
    vi.mocked(chamarApi)
      .mockResolvedValueOnce({ ok: true, dados: { id: RASCUNHO }, cookiesDaApi: [] })
      .mockResolvedValueOnce({
        ok: false,
        erro: { type: 'about:blank', status: 422, code: 'HEALTH_ASSESSMENT_EMPTY', correlationId: '' },
        cookiesDaApi: [],
      } as never);

    const resultado = await salvarFicha(ficha({ publicar: true }));

    // O id volta para a tela seguir editando ESTE rascunho, e não criar outro.
    expect(resultado).toEqual({
      ok: false,
      error: 'Rascunho salvo, mas não publicado: Preencha ao menos uma medida antes de publicar.',
      assessmentId: RASCUNHO,
    });
  });

  it('pressão com uma metade só é recusada antes de chamar a API', async () => {
    const resultado = await salvarFicha(ficha({ entradas: { ...VAZIA, pas: 120 } }));

    expect(resultado).toEqual({ ok: false, error: 'Informe a pressão sistólica e a diastólica juntas.' });
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('ficha sem nenhuma medida é recusada', async () => {
    const resultado = await salvarFicha(ficha({ entradas: VAZIA }));

    expect(resultado).toEqual({ ok: false, error: 'Preencha ao menos uma medida.' });
  });

  it('observação apagada vai como string vazia, para o PATCH limpar a nota', async () => {
    await salvarFicha(ficha({ assessmentId: RASCUNHO, notes: '' }));

    expect(corpoDa(0)['notes']).toBe('');
  });

  it('sistólica igual ou menor que a diastólica é campo trocado e é recusada', async () => {
    const resultado = await salvarFicha(ficha({ entradas: { ...VAZIA, pas: 80, pad: 120 } }));

    expect(resultado).toMatchObject({ ok: false });
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('data no futuro é recusada', async () => {
    const resultado = await salvarFicha(ficha({ assessedOn: '2099-01-01' }));

    expect(resultado).toEqual({ ok: false, error: 'A data da avaliação não pode ser no futuro.' });
  });

  it('zero vem em português, não na mensagem padrão do Zod', async () => {
    const resultado = await salvarFicha(ficha({ entradas: { ...VAZIA, pesoKg: 0 } }));

    expect(resultado).toEqual({ ok: false, error: 'Use valores maiores que zero.' });
  });
});
