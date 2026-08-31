import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { RetentionTasksService } from './retention-tasks.service.js';
import type {
  CandidatoDoDia,
  PoliticaDeCapacidade,
  PortaDeTarefas,
  TarefaGravada,
} from './retention-tasks.repository.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-10T09:00:00.000Z');

const politica = (parcial: Partial<PoliticaDeCapacidade> = {}): PoliticaDeCapacidade => ({
  gymUnitId: 'u1',
  capacidadeDiaria: 20,
  cooldownEmDias: 14,
  slaEmDiasUteis: 3,
  ...parcial,
});

const candidato = (parcial: Partial<CandidatoDoDia> = {}): CandidatoDoDia => ({
  studentId: 'e1',
  gymUnitId: 'u1',
  scoreId: 'sc1',
  valor: 60,
  faixa: 'ALTO',
  estrategia: 'COBRANCA_VENCIDA',
  temTarefaAtiva: false,
  ultimaTarefaEm: null,
  ...parcial,
});

const gravada = (parcial: Partial<TarefaGravada> = {}): TarefaGravada => ({
  id: 'tk1',
  estado: 'ABERTA',
  responsavelId: null,
  resultado: null,
  motivo: null,
  ...parcial,
});

/**
 * Dublê do experimento (F39). `null` = sem experimento ativo, que é o estado
 * normal do produto: a fila funciona sem experimento nenhum.
 */
class ExperimentoFake {
  grupos = new Map<string, 'CONTROLE' | 'TRATAMENTO'>();
  ativo = false;

  grupoDoAluno(_contexto: TenantContext, studentId: string): Promise<'CONTROLE' | 'TRATAMENTO' | null> {
    if (!this.ativo) return Promise.resolve(null);
    return Promise.resolve(this.grupos.get(studentId) ?? null);
  }
}

class PortaFake implements PortaDeTarefas {
  politicas: PoliticaDeCapacidade[] = [politica()];
  candidatos: CandidatoDoDia[] = [candidato()];
  criadas: Parameters<PortaDeTarefas['criarTarefa']>[1][] = [];
  atualizadas: { id: string; tarefa: TarefaGravada }[] = [];
  interacoes: Parameters<PortaDeTarefas['registrarInteracao']>[1][] = [];
  tarefa: TarefaGravada | null = gravada();
  /** Simula a tarefa que a chave única já encontrou. */
  jaExiste = false;

  politicasDoTenant(): Promise<PoliticaDeCapacidade[]> {
    return Promise.resolve(this.politicas);
  }

  candidatosDoDia(): Promise<CandidatoDoDia[]> {
    return Promise.resolve(this.candidatos);
  }

  criarTarefa(
    _contexto: TenantContext,
    entrada: Parameters<PortaDeTarefas['criarTarefa']>[1],
  ): Promise<{ criada: boolean }> {
    this.criadas.push(entrada);
    return Promise.resolve({ criada: !this.jaExiste });
  }

  carregarTarefa(): Promise<TarefaGravada | null> {
    return Promise.resolve(this.tarefa);
  }

  salvarTarefa(
    _contexto: TenantContext,
    id: string,
    tarefa: TarefaGravada,
  ): Promise<void> {
    this.atualizadas.push({ id, tarefa });
    return Promise.resolve();
  }

  registrarInteracao(
    _contexto: TenantContext,
    entrada: Parameters<PortaDeTarefas['registrarInteracao']>[1],
  ): Promise<void> {
    this.interacoes.push(entrada);
    return Promise.resolve();
  }
}

describe('RetentionTasksService — gerarFila', () => {
  let porta: PortaFake;
  let experimento: ExperimentoFake;
  let service: RetentionTasksService;

  beforeEach(() => {
    porta = new PortaFake();
    experimento = new ExperimentoFake();
    service = new RetentionTasksService(porta, experimento as never);
  });

  it('cria tarefa para o candidato e devolve o resumo', async () => {
    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 1, suprimidas: 0 });
    expect(porta.criadas[0]).toMatchObject({
      studentId: 'e1',
      scoreId: 'sc1',
      gymUnitId: 'u1',
      estrategia: 'COBRANCA_VENCIDA',
    });
  });

  it('calcula o vencimento em dias uteis a partir da politica', async () => {
    await service.gerarFila(contexto, agora);

    // Quinta 10/09 + 3 uteis = terca 15/09.
    expect(porta.criadas[0]?.venceEm).toEqual(new Date('2026-09-15T09:00:00.000Z'));
  });

  it('grava a criacao com o "agora" da rodada, nao com o relogio do banco', async () => {
    // O cooldown compara `agora - criadaEm`. Se `criadaEm` viesse do
    // `@default(now())` do Postgres, a conta misturaria dois relogios, e
    // reprocessar um dia passado mediria contra o instante da reexecucao --
    // `M6-AC-004` promete o contrario. Este teste travou um defeito real.
    await service.gerarFila(contexto, agora);

    expect(porta.criadas[0]?.criadaEm).toEqual(agora);
  });

  it('corta na capacidade da unidade -- M6-BR-005', async () => {
    porta.politicas = [politica({ capacidadeDiaria: 2 })];
    porta.candidatos = [
      candidato({ studentId: 'a', scoreId: 's-a', valor: 30 }),
      candidato({ studentId: 'b', scoreId: 's-b', valor: 90 }),
      candidato({ studentId: 'c', scoreId: 's-c', valor: 60 }),
    ];

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 2, suprimidas: 1 });
    expect(porta.criadas.map((c) => c.studentId)).toEqual(['b', 'c']);
  });

  it('suprime quem esta dentro do cooldown -- M6-BR-004', async () => {
    porta.candidatos = [
      candidato({ ultimaTarefaEm: new Date('2026-09-05T09:00:00.000Z') }),
    ];

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 0, suprimidas: 1 });
    expect(porta.criadas).toEqual([]);
  });

  it('nao duplica quando ja ha tarefa ativa -- M6-FR-007', async () => {
    porta.candidatos = [candidato({ temTarefaAtiva: true })];

    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 0, suprimidas: 1 });
  });

  it('conta como suprimida quando a chave unica recusa -- M6-AC-004', async () => {
    porta.jaExiste = true;

    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 0, suprimidas: 1 });
  });

  it('aplica capacidade por unidade, nao por tenant', async () => {
    porta.politicas = [
      politica({ gymUnitId: 'u1', capacidadeDiaria: 1 }),
      politica({ gymUnitId: 'u2', capacidadeDiaria: 2 }),
    ];
    porta.candidatos = [
      candidato({ studentId: 'a', scoreId: 's-a', gymUnitId: 'u1', valor: 90 }),
      candidato({ studentId: 'b', scoreId: 's-b', gymUnitId: 'u1', valor: 80 }),
      candidato({ studentId: 'c', scoreId: 's-c', gymUnitId: 'u2', valor: 70 }),
      candidato({ studentId: 'd', scoreId: 's-d', gymUnitId: 'u2', valor: 60 }),
    ];

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 3, suprimidas: 1 });
    expect(porta.criadas.map((c) => c.studentId).sort()).toEqual(['a', 'c', 'd']);
  });

  it('ignora candidato de unidade sem politica em vez de usar um padrao mudo', async () => {
    porta.candidatos = [candidato({ gymUnitId: 'u-sem-politica' })];

    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 0, suprimidas: 1 });
  });

  it('nao cria tarefa para quem esta no CONTROLE -- M6-FR-011', async () => {
    // O coração do experimento: o controle nunca aparece para a equipe. Sem
    // isso não há comparação -- todo mundo receberia ligação e a pergunta "a
    // ligação adiantou?" ficaria sem grupo contra o qual medir.
    experimento.ativo = true;
    experimento.grupos.set('e1', 'CONTROLE');

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 0, suprimidas: 1 });
    expect(porta.criadas).toEqual([]);
  });

  it('cria tarefa normalmente para quem esta no TRATAMENTO', async () => {
    experimento.ativo = true;
    experimento.grupos.set('e1', 'TRATAMENTO');

    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 1, suprimidas: 0 });
  });

  it('cria tarefa para quem nao esta no experimento', async () => {
    // Aluno fora do experimento (entrou depois da alocação, por exemplo) segue
    // o fluxo normal: excluí-lo seria punir quem não participa.
    experimento.ativo = true;

    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 1, suprimidas: 0 });
  });

  it('ignora o experimento quando nao ha nenhum ativo', async () => {
    experimento.ativo = false;
    experimento.grupos.set('e1', 'CONTROLE');

    // Sem experimento ativo o grupo não vale -- todo elegível entra na fila.
    expect(await service.gerarFila(contexto, agora)).toEqual({ criadas: 1, suprimidas: 0 });
  });

  it('conta o controle como suprimido, nao como falha', async () => {
    experimento.ativo = true;
    experimento.grupos.set('a', 'CONTROLE');
    experimento.grupos.set('b', 'TRATAMENTO');
    porta.candidatos = [
      candidato({ studentId: 'a', scoreId: 's-a', valor: 90 }),
      candidato({ studentId: 'b', scoreId: 's-b', valor: 80 }),
    ];

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo).toEqual({ criadas: 1, suprimidas: 1 });
    expect(porta.criadas.map((c) => c.studentId)).toEqual(['b']);
  });

  it('o controle nao consome vaga de capacidade', async () => {
    // Se o controle consumisse vaga, o experimento reduziria em 20% o trabalho
    // real da recepção -- e o braço de tratamento ficaria menor do que a
    // capacidade permite, enviesando o resultado contra a intervenção.
    experimento.ativo = true;
    experimento.grupos.set('a', 'CONTROLE');
    experimento.grupos.set('b', 'TRATAMENTO');
    experimento.grupos.set('c', 'TRATAMENTO');
    porta.politicas = [politica({ capacidadeDiaria: 2 })];
    porta.candidatos = [
      candidato({ studentId: 'a', scoreId: 's-a', valor: 90 }),
      candidato({ studentId: 'b', scoreId: 's-b', valor: 80 }),
      candidato({ studentId: 'c', scoreId: 's-c', valor: 70 }),
    ];

    const resumo = await service.gerarFila(contexto, agora);

    expect(resumo.criadas).toBe(2);
    expect(porta.criadas.map((c) => c.studentId)).toEqual(['b', 'c']);
  });

  it('e deterministico -- reexecutar o dia da o mesmo resultado', async () => {
    const primeira = await service.gerarFila(contexto, agora);
    porta.criadas = [];
    const segunda = await service.gerarFila(contexto, agora);

    expect(primeira).toEqual(segunda);
  });
});

describe('RetentionTasksService — transicoes', () => {
  let porta: PortaFake;
  let experimento: ExperimentoFake;
  let service: RetentionTasksService;

  beforeEach(() => {
    porta = new PortaFake();
    experimento = new ExperimentoFake();
    service = new RetentionTasksService(porta, experimento as never);
  });

  it('atribui uma tarefa', async () => {
    await service.aplicar(contexto, 'tk1', { tipo: 'ATRIBUIR', responsavelId: 'u9' });

    expect(porta.atualizadas[0]?.tarefa).toMatchObject({
      estado: 'ATRIBUIDA',
      responsavelId: 'u9',
    });
  });

  it('recusa transicao invalida sem gravar nada', async () => {
    await expect(service.aplicar(contexto, 'tk1', { tipo: 'INICIAR' })).rejects.toThrow(
      'TRANSICAO_INVALIDA',
    );
    expect(porta.atualizadas).toEqual([]);
  });

  it('lanca quando a tarefa nao existe', async () => {
    porta.tarefa = null;

    await expect(
      service.aplicar(contexto, 'sumida', { tipo: 'ATRIBUIR', responsavelId: 'u9' }),
    ).rejects.toThrow('TAREFA_NAO_ENCONTRADA');
  });

  it('registra interacao com responsavel, canal e resultado -- M6-AC-006', async () => {
    porta.tarefa = gravada({ estado: 'EM_ATENDIMENTO', responsavelId: 'u9' });

    await service.registrarContato(contexto, 'tk1', {
      canal: 'WHATSAPP',
      resultado: 'SEM_RESPOSTA',
      observacoes: 'Mandei mensagem, sem retorno',
      proximoPasso: 'Tentar de novo amanha',
    });

    expect(porta.interacoes[0]).toMatchObject({
      taskId: 'tk1',
      actorId: 'a1',
      canal: 'WHATSAPP',
      resultado: 'SEM_RESPOSTA',
    });
  });

  it('registrar contato nao conclui a tarefa sozinho', async () => {
    porta.tarefa = gravada({ estado: 'EM_ATENDIMENTO', responsavelId: 'u9' });

    await service.registrarContato(contexto, 'tk1', {
      canal: 'WHATSAPP',
      resultado: 'SEM_RESPOSTA',
    });

    expect(porta.atualizadas).toEqual([]);
  });

  it('recusa interacao em tarefa terminal', async () => {
    porta.tarefa = gravada({ estado: 'CONCLUIDA', resultado: 'CONTATADO' });

    await expect(
      service.registrarContato(contexto, 'tk1', { canal: 'WHATSAPP', resultado: 'CONTATADO' }),
    ).rejects.toThrow('TAREFA_NAO_ESTA_ATIVA');
  });
});
