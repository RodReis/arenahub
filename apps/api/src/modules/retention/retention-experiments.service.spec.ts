import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { RetentionExperimentsService } from './retention-experiments.service.js';
import type {
  AlocacaoGravada,
  ExperimentoAtivo,
  ParticipanteBruto,
  PortaDeExperimentos,
} from './retention-experiments.repository.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-10T09:00:00.000Z');

const experimento = (parcial: Partial<ExperimentoAtivo> = {}): ExperimentoAtivo => ({
  id: 'exp1',
  label: 'piloto@1',
  semente: 'semente-fixa',
  fracaoDeControle: 0.2,
  janelaEmDias: 30,
  ...parcial,
});

class PortaFake implements PortaDeExperimentos {
  ativo: ExperimentoAtivo | null = experimento();
  alocacoes: AlocacaoGravada[] = [];
  gravadas: Parameters<PortaDeExperimentos['gravarAlocacao']>[1][] = [];
  participantes: ParticipanteBruto[] = [];
  /** Simula a chave única encontrando a alocação que já existia. */
  jaAlocado = false;

  experimentoAtivo(): Promise<ExperimentoAtivo | null> {
    return Promise.resolve(this.ativo);
  }

  alocacoesDoExperimento(): Promise<AlocacaoGravada[]> {
    return Promise.resolve(this.alocacoes);
  }

  gravarAlocacao(
    _contexto: TenantContext,
    entrada: Parameters<PortaDeExperimentos['gravarAlocacao']>[1],
  ): Promise<{ criada: boolean }> {
    this.gravadas.push(entrada);
    return Promise.resolve({ criada: !this.jaAlocado });
  }

  participantesParaAnalise(): Promise<ParticipanteBruto[]> {
    return Promise.resolve(this.participantes);
  }
}

describe('RetentionExperimentsService — alocar', () => {
  let porta: PortaFake;
  let service: RetentionExperimentsService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionExperimentsService(porta);
  });

  it('aloca cada aluno em um grupo e grava', async () => {
    const resumo = await service.alocar(contexto, ['a', 'b', 'c'], agora);

    expect(resumo.alocados).toBe(3);
    expect(porta.gravadas).toHaveLength(3);
    expect(porta.gravadas.map((g) => g.studentId)).toEqual(['a', 'b', 'c']);
  });

  it('respeita a fracao congelada do experimento', async () => {
    porta.ativo = experimento({ fracaoDeControle: 1 });

    await service.alocar(contexto, ['a', 'b'], agora);

    expect(porta.gravadas.every((g) => g.grupo === 'CONTROLE')).toBe(true);
  });

  it('e reproduzivel: o mesmo aluno cai sempre no mesmo grupo', async () => {
    await service.alocar(contexto, ['aluno-x'], agora);
    const primeiro = porta.gravadas[0]?.grupo;

    porta.gravadas = [];
    await service.alocar(contexto, ['aluno-x'], agora);

    expect(porta.gravadas[0]?.grupo).toBe(primeiro);
  });

  it('nao realoca quem ja esta no experimento -- M6-FR-012', async () => {
    porta.jaAlocado = true;

    const resumo = await service.alocar(contexto, ['a'], agora);

    expect(resumo).toEqual({ alocados: 0, jaAlocados: 1 });
  });

  it('nao aloca ninguem quando nao ha experimento ativo', async () => {
    porta.ativo = null;

    expect(await service.alocar(contexto, ['a', 'b'], agora)).toEqual({
      alocados: 0,
      jaAlocados: 0,
    });
    expect(porta.gravadas).toEqual([]);
  });

  it('grava o instante da alocacao explicito, nao o relogio do banco', async () => {
    await service.alocar(contexto, ['a'], agora);

    // A janela de medicao conta a partir daqui, por aluno. Se viesse do
    // `now()` do Postgres, a conta misturaria dois relogios -- o defeito que a
    // F38 achou por canário.
    expect(porta.gravadas[0]?.alocadoEm).toEqual(agora);
  });
});

describe('RetentionExperimentsService — grupoDoAluno', () => {
  let porta: PortaFake;
  let service: RetentionExperimentsService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionExperimentsService(porta);
  });

  it('devolve o grupo GRAVADO, nao o recalculado', async () => {
    // A gravacao e a fonte da verdade sobre quem entrou e quando. Recalcular na
    // leitura faria uma mudanca de semente mover alunos retroativamente.
    porta.alocacoes = [{ studentId: 'a', grupo: 'CONTROLE', alocadoEm: agora }];

    expect(await service.grupoDoAluno(contexto, 'a')).toBe('CONTROLE');
  });

  it('devolve null para quem nao esta no experimento', async () => {
    expect(await service.grupoDoAluno(contexto, 'desconhecido')).toBeNull();
  });

  it('devolve null quando nao ha experimento ativo', async () => {
    porta.ativo = null;

    expect(await service.grupoDoAluno(contexto, 'a')).toBeNull();
  });
});

describe('RetentionExperimentsService — analisar', () => {
  let porta: PortaFake;
  let service: RetentionExperimentsService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionExperimentsService(porta);
  });

  it('devolve a analise ITT dos participantes', async () => {
    porta.participantes = [
      { studentId: 'a', grupo: 'TRATAMENTO', permaneceu: true, contatado: true, adversos: [] },
      { studentId: 'b', grupo: 'TRATAMENTO', permaneceu: false, contatado: false, adversos: ['RECUSOU'] },
      { studentId: 'c', grupo: 'CONTROLE', permaneceu: true, contatado: false, adversos: [] },
    ];

    const resultado = await service.analisar(contexto);

    expect(resultado?.tratamento.participantes).toBe(2);
    expect(resultado?.controle.participantes).toBe(1);
    expect(resultado?.tratamento.adversos.RECUSOU).toBe(1);
  });

  it('marca como nao conclusivo com amostra pequena', async () => {
    porta.participantes = [
      { studentId: 'a', grupo: 'TRATAMENTO', permaneceu: true, contatado: true, adversos: [] },
    ];

    expect((await service.analisar(contexto))?.conclusivo).toBe(false);
  });

  it('devolve null quando nao ha experimento ativo', async () => {
    porta.ativo = null;

    expect(await service.analisar(contexto)).toBeNull();
  });
});
