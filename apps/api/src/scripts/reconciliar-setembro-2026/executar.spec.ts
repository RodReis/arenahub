import { describe, expect, it } from '@jest/globals';

import type { PlanoDaPessoa } from './dominio.js';
import { executarReconciliacao, type PortasDaReconciliacao } from './executar.js';

const PAGO_EM = new Date(Date.UTC(2026, 8, 5));

function plano(nome: string, acoes: PlanoDaPessoa['acoes'], extra: Partial<PlanoDaPessoa> = {}): PlanoDaPessoa {
  return {
    pessoa: { nome, cpf: '', permissao: '1', nascimento: new Date('1990-01-01'), telefone: '', email: '' },
    studentId: `id-${nome}`,
    pagou: true,
    acoes,
    pendencia: null,
    ...extra,
  };
}

function portasGravando(totalDaFatura = 15000): { portas: PortasDaReconciliacao; chamadas: string[] } {
  const chamadas: string[] = [];
  const portas: PortasDaReconciliacao = {
    criarAluno: (p) => {
      chamadas.push(`criar:${p.nome}`);
      return Promise.resolve('novo-id');
    },
    reativarAluno: (id) => Promise.resolve(void chamadas.push(`reativar:${id}`)),
    ativarAssinatura: (id) => Promise.resolve(void chamadas.push(`ativar:${id}`)),
    cancelarAssinatura: (id) => Promise.resolve(void chamadas.push(`cancelar:${id}`)),
    abrirFatura: (id) => {
      chamadas.push(`fatura:${id}`);
      return Promise.resolve({ id: `fat-${id}`, totalMinor: totalDaFatura });
    },
    darBaixa: (faturaId, valor) => Promise.resolve(void chamadas.push(`baixa:${faturaId}:${String(valor)}`)),
  };
  return { portas, chamadas };
}

describe('executarReconciliacao', () => {
  it('aluno novo: o id criado segue para assinatura, fatura e baixa', async () => {
    const { portas, chamadas } = portasGravando();

    await executarReconciliacao(
      [
        plano(
          'Hugo',
          [
            { tipo: 'CRIAR_ALUNO' },
            { tipo: 'ATIVAR_ASSINATURA', planoId: null },
            { tipo: 'ABRIR_FATURA' },
            { tipo: 'DAR_BAIXA', faturaId: null, totalMinor: null, valorMinor: 15000, pagoEm: PAGO_EM },
          ],
          { studentId: null },
        ),
      ],
      portas,
    );

    expect(chamadas).toEqual(['criar:Hugo', 'ativar:novo-id', 'fatura:novo-id', 'baixa:fat-novo-id:15000']);
  });

  it('valor divergente da fatura NAO da baixa e vira falha (regra do PI, #386)', async () => {
    const { portas, chamadas } = portasGravando(15000);

    const resultado = await executarReconciliacao(
      [plano('Ivo', [{ tipo: 'DAR_BAIXA', faturaId: 'f1', totalMinor: 15000, valorMinor: 20000, pagoEm: PAGO_EM }])],
      portas,
    );

    expect(chamadas).toEqual([]);
    expect(resultado.falhas[0]!.erro).toContain('VALOR_DIVERGENTE');
  });

  it('falha de uma pessoa nao impede as demais', async () => {
    const { portas, chamadas } = portasGravando();
    portas.reativarAluno = () => Promise.reject(new Error('versao desatualizada'));

    const resultado = await executarReconciliacao(
      [plano('Eva', [{ tipo: 'REATIVAR_ALUNO' }]), plano('Duda', [{ tipo: 'ABRIR_FATURA' }])],
      portas,
    );

    expect(resultado).toEqual({ aplicados: 1, falhas: [{ nome: 'Eva', erro: 'versao desatualizada' }] });
    expect(chamadas).toEqual(['fatura:id-Duda']);
  });

  it('pendencia nunca e executada', async () => {
    const { portas, chamadas } = portasGravando();

    await executarReconciliacao([plano('Gil', [{ tipo: 'ABRIR_FATURA' }], { pendencia: 'PERFIL_TRAINER' })], portas);

    expect(chamadas).toEqual([]);
  });
});
