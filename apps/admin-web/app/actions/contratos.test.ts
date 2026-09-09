import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { criarContrato, registrarValorDeIndice, salvarPlano } from './contratos';

const chamada = vi.mocked(chamarApi);

/** O corpo que a action mandou para a API, na chamada `n`. */
function corpoEnviado(n = 0): Record<string, unknown> {
  const opcoes = chamada.mock.calls[n]?.[1] as { corpo?: Record<string, unknown> } | undefined;

  return opcoes?.corpo ?? {};
}

function formularioDePlanoFixo(valor: string): FormData {
  const dados = new FormData();

  dados.set('name', 'Plano fixo');
  dados.set('model', 'FIXED_MONTHLY');
  dados.set('fixedPrice', valor);

  return dados;
}

function formularioDePlanoPorAluno(ativo: string, inativo: string): FormData {
  const dados = new FormData();

  dados.set('name', 'Plano por aluno');
  dados.set('model', 'PER_STUDENT');
  dados.set('activeStudentPrice', ativo);
  dados.set('inactiveStudentPrice', inativo);

  return dados;
}

beforeEach(() => {
  vi.clearAllMocks();
  chamada.mockResolvedValue({ ok: true, dados: { id: 'plano-1' }, cookiesDaApi: [] });
});

describe('salvarPlano', () => {
  it('converte o valor digitado para centavos inteiros', async () => {
    await salvarPlano({}, formularioDePlanoFixo('1.499,00'));

    expect(corpoEnviado()).toMatchObject({ fixedPriceMinor: 149_900 });
  });

  it('nao perde o centavo por ponto flutuante', async () => {
    // `parseFloat('5.00') * 100` da 499,999...; ler os centavos como digitos
    // e o que mantem 500 exato.
    await salvarPlano({}, formularioDePlanoFixo('5,00'));

    expect(corpoEnviado()).toMatchObject({ fixedPriceMinor: 500 });
  });

  it('aceita o valor sem centavos', async () => {
    await salvarPlano({}, formularioDePlanoFixo('1200'));

    expect(corpoEnviado()).toMatchObject({ fixedPriceMinor: 120_000 });
  });

  it('aceita a mascara com R$ e separador de milhar', async () => {
    await salvarPlano({}, formularioDePlanoFixo('R$ 12.345,67'));

    expect(corpoEnviado()).toMatchObject({ fixedPriceMinor: 1_234_567 });
  });

  it('manda SO os precos do modelo escolhido', async () => {
    // Mandar os tres campos deixaria a API recusar por incoerencia -- e o
    // formulario esconde os que nao valem, entao eles chegam vazios.
    await salvarPlano({}, formularioDePlanoPorAluno('5,00', '2,50'));

    const corpo = corpoEnviado();

    expect(corpo).toMatchObject({ activeStudentPriceMinor: 500, inactiveStudentPriceMinor: 250 });
    expect(corpo).not.toHaveProperty('fixedPriceMinor');
  });

  it('preco zero no aluno inativo passa -- e negociado por contrato', async () => {
    await salvarPlano({}, formularioDePlanoPorAluno('5,00', '0'));

    expect(corpoEnviado()).toMatchObject({ inactiveStudentPriceMinor: 0 });
  });

  it('recusa valor com letra sem chamar a API', async () => {
    const estado = await salvarPlano({}, formularioDePlanoFixo('mil reais'));

    expect(estado.erro).toContain('Valor inválido');
    expect(chamada).not.toHaveBeenCalled();
  });

  it('recusa preco por aluno em branco -- campo escondido nao valida sozinho', async () => {
    // O formulario esconde os campos do outro modelo, e `required` nativo em
    // campo escondido morre calado. A presenca e conferida aqui.
    const estado = await salvarPlano({}, formularioDePlanoPorAluno('', '2,50'));

    expect(estado.erro).toContain('aluno ativo');
    expect(chamada).not.toHaveBeenCalled();
  });

  it('traduz a recusa da API em vez de mostrar o codigo cru', async () => {
    chamada.mockResolvedValue({
      ok: false,
      cookiesDaApi: [],
      erro: {
        type: 'about:blank',
        title: 'Conflito',
        status: 409,
        code: 'SAAS_PLAN_ARCHIVED',
        correlationId: 'x',
      },
    });

    const estado = await salvarPlano({}, formularioDePlanoFixo('100,00'));

    expect(estado.erro).toBe('Este plano está arquivado e não aceita contrato novo.');
  });

  it('devolve o que foi digitado quando recusa, para o formulario nao esvaziar', async () => {
    const estado = await salvarPlano({}, formularioDePlanoFixo('nao e numero'));

    expect(estado.valores?.['name']).toBe('Plano fixo');
    expect(estado.valores?.['fixedPrice']).toBe('nao e numero');
  });
});

describe('registrarValorDeIndice', () => {
  const formulario = (variacao: string, competencia = '2026-03'): FormData => {
    const dados = new FormData();

    dados.set('code', 'IPCA');
    dados.set('competencia', competencia);
    dados.set('variacao', variacao);

    return dados;
  };

  it('converte porcento em milesimos de ponto percentual', async () => {
    // O IBGE publica 0,44%. O banco guarda 440.
    await registrarValorDeIndice({}, formulario('0,44'));

    expect(corpoEnviado()).toMatchObject({ variationBasisPoints: 440 });
  });

  it('aceita deflacao', async () => {
    await registrarValorDeIndice({}, formulario('-0,15'));

    expect(corpoEnviado()).toMatchObject({ variationBasisPoints: -150 });
  });

  it('aceita o sinal de porcento digitado junto', async () => {
    await registrarValorDeIndice({}, formulario('1,25%'));

    expect(corpoEnviado()).toMatchObject({ variationBasisPoints: 1250 });
  });

  it('recusa competencia com dia', async () => {
    const estado = await registrarValorDeIndice({}, formulario('0,44', '2026-03-15'));

    expect(estado.erro).toContain('AAAA-MM');
    expect(chamada).not.toHaveBeenCalled();
  });
});

describe('criarContrato', () => {
  const formulario = (extras: Record<string, string> = {}): FormData => {
    const dados = new FormData();

    dados.set('tenantId', '0f1c9d4e-6a2b-4c8d-9e3f-1a2b3c4d5e6f');
    dados.set('planId', '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e');
    dados.set('baseDate', '2026-03-01');
    dados.set('startsAt', '2026-03-01');
    dados.set('anniversaryDay', '1');
    dados.set('anniversaryMonth', '3');
    dados.set('issueDay', '1');
    dados.set('graceDays', '15');
    dados.set('indexCode', 'IPCA');

    for (const [campo, valor] of Object.entries(extras)) dados.set(campo, valor);

    return dados;
  };

  it('manda o tenant e os campos do contrato', async () => {
    await criarContrato({}, formulario());

    expect(corpoEnviado()).toMatchObject({
      tenantId: '0f1c9d4e-6a2b-4c8d-9e3f-1a2b3c4d5e6f',
      planId: '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
      issueDay: 1,
      graceDays: 15,
      indexCode: 'IPCA',
    });
  });

  it('recusa dia de emissao acima de 28 sem chamar a API', async () => {
    // 29, 30 e 31 nao existem em fevereiro, e aceita-los criaria um contrato
    // cuja fatura pula um mes por ano.
    const estado = await criarContrato({}, formulario({ issueDay: '31' }));

    expect(estado.erro).toContain('Dia de emissão');
    expect(chamada).not.toHaveBeenCalled();
  });

  it('traduz a recusa de contrato ja vigente', async () => {
    chamada.mockResolvedValue({
      ok: false,
      cookiesDaApi: [],
      erro: {
        type: 'about:blank',
        title: 'Conflito',
        status: 409,
        code: 'TENANT_CONTRACT_ALREADY_ACTIVE',
        correlationId: 'x',
      },
    });

    const estado = await criarContrato({}, formulario());

    expect(estado.erro).toContain('já tem um contrato vigente');
  });
});
