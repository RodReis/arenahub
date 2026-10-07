import { describe, expect, it } from '@jest/globals';

import { planejarReconciliacao, type AlunoDaBase, type PessoaDaCatraca } from './dominio.js';

const CPF_ANA = '529.982.247-25';
const CPF_BIA = '111.444.777-35';

function pessoa(nome: string, extra: Partial<PessoaDaCatraca> = {}): PessoaDaCatraca {
  return {
    nome,
    cpf: '',
    permissao: '1',
    nascimento: new Date('1990-01-01'),
    telefone: '',
    email: '',
    ...extra,
  };
}

function aluno(nome: string, extra: Partial<AlunoDaBase> = {}): AlunoDaBase {
  return {
    id: `id-${nome}`,
    nome,
    cpf: null,
    status: 'ACTIVE',
    profile: 'STUDENT',
    assinaturaAtivaId: 'sub-ativa',
    planoId: 'plano-1',
    orfas: [],
    faturaSet: { id: 'fat-1', status: 'OPEN', totalMinor: 15000 },
    ...extra,
  };
}

const PAGOU = (nome: string, valor = 150) => ({ nome, data: '05/09/2026', valor });

describe('planejarReconciliacao', () => {
  it('ignora quem nao e aluno na catraca (permissao 3/4 = time)', () => {
    const planos = planejarReconciliacao([pessoa('Treinador', { permissao: '3' })], [], []);
    expect(planos).toEqual([]);
  });

  it('casa por CPF mesmo com nome diferente e da baixa na fatura aberta', () => {
    const planos = planejarReconciliacao(
      [pessoa('Ana S.', { cpf: CPF_ANA })],
      [PAGOU('Ana S.')],
      [aluno('Ana Souza', { cpf: '52998224725' })],
    );

    expect(planos[0]!.studentId).toBe('id-Ana Souza');
    expect(planos[0]!.acoes).toEqual([
      { tipo: 'DAR_BAIXA', faturaId: 'fat-1', totalMinor: 15000, valorMinor: 15000, pagoEm: new Date(Date.UTC(2026, 8, 5, 12)) },
    ]);
  });

  it('#450: sem assinatura ACTIVE -- ativa nova ANTES de cancelar a orfa, abre fatura e da baixa', () => {
    const planos = planejarReconciliacao(
      [pessoa('Bia', { cpf: CPF_BIA })],
      [PAGOU('Bia')],
      [
        aluno('Bia', {
          cpf: '11144477735',
          assinaturaAtivaId: null,
          orfas: [{ id: 'sub-morta', versao: 3 }],
          faturaSet: null,
        }),
      ],
    );

    expect(planos[0]!.acoes.map((a) => a.tipo)).toEqual([
      'ATIVAR_ASSINATURA',
      'CANCELAR_ORFA',
      'ABRIR_FATURA',
      'DAR_BAIXA',
    ]);
  });

  it('quem nao pagou recebe a fatura mas nao a baixa -- vira inadimplente', () => {
    const planos = planejarReconciliacao(
      [pessoa('Caio')],
      [],
      [aluno('Caio', { assinaturaAtivaId: null, faturaSet: null })],
    );

    expect(planos[0]!.acoes.map((a) => a.tipo)).toEqual(['ATIVAR_ASSINATURA', 'ABRIR_FATURA']);
  });

  it('nada a fazer quando ja esta PAID', () => {
    const planos = planejarReconciliacao(
      [pessoa('Duda')],
      [PAGOU('Duda')],
      [aluno('Duda', { faturaSet: { id: 'f', status: 'PAID', totalMinor: 15000 } })],
    );

    expect(planos[0]!.acoes).toEqual([]);
    expect(planos[0]!.pendencia).toBeNull();
  });

  it('aluno CANCELLED que pagou e reativado primeiro (decisao do PI, 29/09)', () => {
    const planos = planejarReconciliacao(
      [pessoa('Eva')],
      [PAGOU('Eva')],
      [aluno('Eva', { status: 'CANCELLED', assinaturaAtivaId: null, faturaSet: null })],
    );

    expect(planos[0]!.acoes[0]).toEqual({ tipo: 'REATIVAR_ALUNO' });
  });

  it('aluno CANCELLED que NAO pagou vira pendencia, sem nenhuma acao', () => {
    const planos = planejarReconciliacao(
      [pessoa('Fabi')],
      [],
      [aluno('Fabi', { status: 'CANCELLED', assinaturaAtivaId: null, faturaSet: null })],
    );

    expect(planos[0]!.acoes).toEqual([]);
    expect(planos[0]!.pendencia).toBe('CANCELADO_SEM_PAGAMENTO');
  });

  it('perfil de time na base vira pendencia (os 2 TRAINER que pagaram)', () => {
    const planos = planejarReconciliacao([pessoa('Gil')], [PAGOU('Gil')], [aluno('Gil', { profile: 'TRAINER' })]);

    expect(planos[0]!.acoes).toEqual([]);
    expect(planos[0]!.pendencia).toBe('PERFIL_TRAINER');
  });

  it('nao existe na base: cria aluno e segue o fluxo completo', () => {
    const planos = planejarReconciliacao([pessoa('Hugo')], [PAGOU('Hugo')], []);

    expect(planos[0]!.studentId).toBeNull();
    expect(planos[0]!.acoes.map((a) => a.tipo)).toEqual(['CRIAR_ALUNO', 'ATIVAR_ASSINATURA', 'ABRIR_FATURA', 'DAR_BAIXA']);
  });

  it('novo sem nascimento valido vira pendencia -- o cadastro exige data', () => {
    const planos = planejarReconciliacao([pessoa('Iris', { nascimento: null })], [], []);

    expect(planos[0]!.pendencia).toBe('SEM_NASCIMENTO');
    expect(planos[0]!.acoes).toEqual([]);
  });

  it('nome repetido na base sem CPF que desempate vira pendencia -- nunca escolhe', () => {
    const planos = planejarReconciliacao(
      [pessoa('Joao')],
      [],
      [aluno('Joao', { id: 'j1' }), aluno('Joao', { id: 'j2' })],
    );

    expect(planos[0]!.pendencia).toBe('AMBIGUO');
  });

  it('pagamento repetido no relatorio vira pendencia -- pode ser digitacao ou pagamento em dobro', () => {
    const planos = planejarReconciliacao([pessoa('Kai')], [PAGOU('Kai'), PAGOU('Kai')], [aluno('Kai')]);

    expect(planos[0]!.pendencia).toBe('PAGAMENTO_REPETIDO');
    expect(planos[0]!.acoes).toEqual([]);
  });
});
