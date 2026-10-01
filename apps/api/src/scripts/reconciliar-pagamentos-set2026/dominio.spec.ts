import { describe, expect, it } from '@jest/globals';

import { planejarPagamentos, type AlunoDaBase, type Pagamento } from './dominio.js';

const CPF_ANA = '529.982.247-25';
const PROTOCOLOS = { id: 'p-prot', nome: 'Plano Individuais - Protocolos' };
const FAMILIAR = { id: 'p-fam', nome: 'Plano Familiar' };
const PLANOS = new Map([
  [15000, PROTOCOLOS],
  [20000, FAMILIAR],
]);
const CPFS = new Map([['ana silva', [CPF_ANA]]]);

function aluno(nome: string, extra: Partial<AlunoDaBase> = {}): AlunoDaBase {
  return {
    id: `id-${nome}`,
    nome,
    cpf: null,
    status: 'ACTIVE',
    profile: 'STUDENT',
    assinaturaAtivaId: 'sub-1',
    planoId: PROTOCOLOS.id,
    faturaSet: { id: 'fat-1', status: 'OPEN', totalMinor: 15000 },
    ...extra,
  };
}

const pago = (nome: string, valor: number, data = '05/09/2026'): Pagamento => ({ nome, data, valor });
const planejar = (p: Pagamento[], alunos: AlunoDaBase[]) => planejarPagamentos(p, CPFS, alunos, PLANOS);

describe('planejarPagamentos', () => {
  it('fatura aberta com o valor certo e plano certo: so da baixa', () => {
    const [r] = planejar([pago('Bia', 150)], [aluno('Bia')]);

    expect(r!.pendencia).toBeNull();
    expect(r!.acoes).toEqual([
      { tipo: 'DAR_BAIXA', faturaId: 'fat-1', valorMinor: 15000, pagoEm: new Date('2026-09-05T00:00:00Z') },
    ]);
  });

  it('fatura ja paga e plano certo: nada a fazer', () => {
    const paga = { id: 'f', status: 'PAID', totalMinor: 15000 };
    const [r] = planejar([pago('Bia', 150)], [aluno('Bia', { faturaSet: paga })]);

    expect(r!.acoes).toEqual([]);
    expect(r!.pendencia).toBeNull();
  });

  it('valor 200 em assinatura de Protocolos: troca para Familiar, corrige a fatura aberta e da baixa', () => {
    const [r] = planejar([pago('Bia', 200)], [aluno('Bia')]);

    expect(r!.acoes.map((a) => a.tipo)).toEqual(['TROCAR_PLANO', 'CORRIGIR_VALOR', 'DAR_BAIXA']);
    expect(r!.acoes[0]).toEqual({ tipo: 'TROCAR_PLANO', planoId: FAMILIAR.id, planoNome: FAMILIAR.nome });
  });

  it('fatura paga no valor do relatorio mas em plano errado: so troca o plano', () => {
    const paga = { id: 'f', status: 'PAID', totalMinor: 20000 };
    const [r] = planejar([pago('Bia', 200)], [aluno('Bia', { faturaSet: paga })]);

    expect(r!.acoes.map((a) => a.tipo)).toEqual(['TROCAR_PLANO']);
  });

  it('sem fatura de setembro: abre e da baixa', () => {
    const [r] = planejar([pago('Bia', 150)], [aluno('Bia', { faturaSet: null })]);

    expect(r!.acoes.map((a) => a.tipo)).toEqual(['ABRIR_FATURA', 'DAR_BAIXA']);
  });

  it('valor que nao e preco de plano nao e adivinhado', () => {
    const [r] = planejar([pago('Bia', 60)], [aluno('Bia')]);

    expect(r).toMatchObject({ acoes: [], pendencia: 'VALOR_SEM_PLANO' });
  });

  it('nome com duas linhas no relatorio vira pendencia nas duas', () => {
    const r = planejar([pago('Bia', 150), pago('BIA', 150, '28/09/2026')], [aluno('Bia')]);

    expect(r.map((x) => x.pendencia)).toEqual(['PAGAMENTO_REPETIDO', 'PAGAMENTO_REPETIDO']);
  });

  it('casa por CPF da catraca mesmo com nome diferente na base', () => {
    const [r] = planejar([pago('Ana Silva', 150)], [aluno('Ana S. Souza', { cpf: '52998224725' })]);

    expect(r!.studentId).toBe('id-Ana S. Souza');
    expect(r!.pendencia).toBeNull();
  });

  it('dois alunos com o mesmo nome e sem CPF que resolva: ambiguo', () => {
    const [r] = planejar([pago('Bia', 150)], [aluno('Bia'), { ...aluno('Bia'), id: 'outro' }]);

    expect(r!.pendencia).toBe('AMBIGUO');
  });

  it('nome que nao existe na base: sem aluno', () => {
    expect(planejar([pago('Zed', 150)], [aluno('Bia')])[0]!.pendencia).toBe('SEM_ALUNO');
  });

  it('fatura paga com valor diferente do relatorio nao e mexida', () => {
    const paga = { id: 'f', status: 'PAID', totalMinor: 15000 };
    const [r] = planejar([pago('Bia', 200)], [aluno('Bia', { faturaSet: paga })]);

    expect(r).toMatchObject({ acoes: [], pendencia: 'FATURA_PAGA_VALOR_DIVERGENTE' });
  });

  it('aluno sem assinatura ativa nao ganha plano calado', () => {
    const [r] = planejar([pago('Bia', 150)], [aluno('Bia', { assinaturaAtivaId: null })]);

    expect(r!.pendencia).toBe('SEM_ASSINATURA_ATIVA');
  });
});
