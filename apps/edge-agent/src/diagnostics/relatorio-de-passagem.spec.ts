import { describe, expect, it } from '@jest/globals';

import {
  MATRIZ_NEGATIVA,
  montarRelatorio,
  resumir,
  type AmostraDeLatencia,
  type ResultadoDaMatriz,
} from './relatorio-de-passagem.js';

/**
 * O CRITERIO DE APROVACAO roda no CI, mesmo que a medicao nao role.
 *
 * A parte que fala com a catraca precisa da bancada. Mas o julgamento --
 * "este p95 passa?", "esta matriz aprova?" -- e calculo puro, e e onde um
 * erro seria mais caro: um veredito frouxo aprovaria hardware que nao
 * deveria entrar em producao, e ninguem reconferiria a conta.
 */

const amostra = (decisaoMs: number, extras: Partial<AmostraDeLatencia> = {}): AmostraDeLatencia => ({
  trial: 1,
  decisaoMs,
  outcome: 'ALLOW',
  ...extras,
});

const casoDaMatriz = (aprovado: boolean): ResultadoDaMatriz => ({
  caso: 'X',
  descricao: 'x',
  deveLiberar: false,
  liberou: !aprovado,
  outcome: 'DENY',
  reason: 'NO_ENTITLEMENT',
  accessEventId: null,
  aprovado,
});

describe('resumo de latencia', () => {
  it('usa nearest-rank -- nao inventa valor que nao foi medido', () => {
    const amostras = [10, 20, 30, 40, 50].map((ms) => amostra(ms));

    const resumo = resumir(amostras);

    // Todos os percentis saem da lista real.
    expect([10, 20, 30, 40, 50]).toContain(resumo.p50);
    expect([10, 20, 30, 40, 50]).toContain(resumo.p95);
    expect(resumo.max).toBe(50);
    expect(resumo.n).toBe(5);
  });

  it('soma decisao e comando -- a pessoa espera os dois', () => {
    const resumo = resumir([amostra(100, { comandoMs: 50 })]);

    expect(resumo.p50).toBe(150);
  });

  it('exclui amostras com erro da conta, mas as CONTA como erro', () => {
    const resumo = resumir([
      amostra(10),
      amostra(20),
      amostra(9999, { erro: 'timeout do equipamento' }),
    ]);

    expect(resumo.n).toBe(2);
    expect(resumo.erros).toBe(1);
    // O timeout nao entra no maximo: ele seria o pior numero e nao e latencia.
    expect(resumo.max).toBe(20);
  });

  it('nao quebra com lista vazia', () => {
    expect(resumir([])).toMatchObject({ n: 0, max: 0, erros: 0 });
  });
});

describe('veredito do relatorio', () => {
  const base = {
    executadoEm: '2026-08-16T12:00:00.000Z',
    modeloDoEquipamento: 'Topdata Inner Fit',
    firmware: '1.2.3',
    comandoFisicoHabilitado: true,
    limiteDoMvp0Ms: null,
  };

  it('aprova quando o p95 fica dentro do objetivo de 300 ms', () => {
    const amostras = Array.from({ length: 100 }, () => amostra(120));

    const relatorio = montarRelatorio({ ...base, amostras, matriz: [] });

    expect(relatorio.objetivoMs).toBe(300);
    expect(relatorio.dentroDoObjetivo).toBe(true);
  });

  it('reprova quando o p95 estoura o objetivo', () => {
    const amostras = Array.from({ length: 100 }, (_, i) => amostra(i < 90 ? 100 : 800));

    const relatorio = montarRelatorio({ ...base, amostras, matriz: [] });

    expect(relatorio.dentroDoObjetivo).toBe(false);
  });

  it('o limite medido no MVP 0 VENCE o objetivo quando e mais restritivo', () => {
    const amostras = Array.from({ length: 100 }, () => amostra(250));

    const relatorio = montarRelatorio({ ...base, amostras, matriz: [], limiteDoMvp0Ms: 200 });

    // 250 ms passaria no objetivo de 300, mas nao no limite medido NESTE
    // hardware -- e e o hardware que manda.
    expect(relatorio.objetivoMs).toBe(200);
    expect(relatorio.dentroDoObjetivo).toBe(false);
  });

  it('reprova a matriz inteira quando UM caso falha', () => {
    const relatorio = montarRelatorio({
      ...base,
      amostras: [amostra(100)],
      matriz: [casoDaMatriz(true), casoDaMatriz(true), casoDaMatriz(false)],
    });

    expect(relatorio.matrizAprovada).toBe(false);
  });

  it('aprova a matriz so quando todos os casos passam', () => {
    const relatorio = montarRelatorio({
      ...base,
      amostras: [amostra(100)],
      matriz: [casoDaMatriz(true), casoDaMatriz(true)],
    });

    expect(relatorio.matrizAprovada).toBe(true);
  });

  it('registra se o comando fisico estava habilitado -- muda o que o numero significa', () => {
    const relatorio = montarRelatorio({
      ...base,
      comandoFisicoHabilitado: false,
      amostras: [amostra(100)],
      matriz: [],
    });

    // Sem comando fisico, a latencia nao inclui o tempo mecanico. Omitir
    // isso do relatorio faria um numero de observacao passar por medicao
    // completa.
    expect(relatorio.comandoFisicoHabilitado).toBe(false);
  });
});

describe('matriz negativa (M1-AC-006)', () => {
  it('cobre as seis razoes de DENY do ADR-024 mais falha de comunicacao', () => {
    const casos = MATRIZ_NEGATIVA.map((m) => m.caso);

    expect(casos).toEqual(
      expect.arrayContaining([
        'DIREITO_EXPIRADO',
        'FORA_DO_HORARIO',
        'ALUNO_BLOQUEADO',
        'BLOQUEIO_ADMINISTRATIVO',
        'BIOMETRIA_REVOGADA',
        'IDENTIDADE_DESCONHECIDA',
        'UNIDADE_ERRADA',
        'RECONHECIMENTO_DUPLICADO',
        'NUVEM_INDISPONIVEL',
      ]),
    );
  });

  it('inclui um caso de CONTROLE que deve liberar', () => {
    // Matriz onde nada pode passar nao prova que algo passa quando deve --
    // um sistema quebrado que nega tudo passaria.
    const controle = MATRIZ_NEGATIVA.filter((m) => m.deveLiberar);

    expect(controle).toHaveLength(1);
    expect(controle[0]?.caso).toBe('CONTROLE_VALIDO');
  });
});
