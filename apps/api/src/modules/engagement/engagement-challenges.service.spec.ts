import { describe, expect, it } from '@jest/globals';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { EngagementChallengesService } from './engagement-challenges.service.js';
import { FakePortaDeDesafios } from './engagement-challenges.repository.fake.js';
import type { DesafioPersistido, TemplateVigente } from './engagement-challenges.repository.js';

const CTX: TenantContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
} as TenantContext;

const UNIDADE = '22222222-2222-4222-8222-222222222222';
const ALUNO = '33333333-3333-4333-8333-333333333333';
const OUTRO_ALUNO = '44444444-4444-4444-8444-444444444444';

const TEMPLATE: TemplateVigente = {
  id: 't-1',
  code: 'assiduidade-semanal',
  version: 1,
  name: 'Assiduidade semanal',
  metric: 'SESSOES_NA_JANELA',
  limite: { maxSessoesPorSemana: 5, maxJanelaEmDias: 60 },
};

const DESAFIO_ATIVO: DesafioPersistido = {
  id: 'c-ativo',
  status: 'ACTIVE',
  startsOn: '2026-09-01',
  endsOn: '2026-09-14',
  targetValue: 8,
  title: 'Setembro em dia',
  gymUnitId: UNIDADE,
  templateVersionId: 't-1',
};

/**
 * ⚠️ Uma instancia POR TESTE.
 *
 * O fake guarda estado; compartilhar entre `it`s faria o desafio criado num
 * bloco aparecer no seguinte.
 */
function montar(configurar?: (fake: FakePortaDeDesafios) => void): {
  service: EngagementChallengesService;
  fake: FakePortaDeDesafios;
} {
  const fake = new FakePortaDeDesafios();
  configurar?.(fake);

  return { service: new EngagementChallengesService(fake), fake };
}

describe('criar (a secretaria cria a partir de template)', () => {
  it('cria o desafio quando a meta cabe no teto do template', async () => {
    const { service, fake } = montar((f) => f.comTemplate(TEMPLATE));

    const { id } = await service.criar(CTX, {
      templateVersionId: 't-1',
      gymUnitId: UNIDADE,
      title: 'Setembro em dia',
      targetValue: 10,
      startsOn: '2026-09-01',
      endsOn: '2026-09-14',
    });

    expect(fake.desafioDe(id)).toMatchObject({
      title: 'Setembro em dia',
      targetValue: 10,
      status: 'DRAFT',
    });
  });

  /** `M5-BR-011` -- o teto profissional e o motivo de o template existir. */
  it('recusa meta acima do limite profissional', async () => {
    const { service } = montar((f) => f.comTemplate(TEMPLATE));

    await expect(
      service.criar(CTX, {
        templateVersionId: 't-1',
        gymUnitId: UNIDADE,
        title: 'Todo dia',
        targetValue: 30,
        startsOn: '2026-09-01',
        endsOn: '2026-09-30',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa template inexistente ou nao vigente', async () => {
    const { service } = montar();

    await expect(
      service.criar(CTX, {
        templateVersionId: 'nao-existe',
        gymUnitId: UNIDADE,
        title: 'x',
        targetValue: 5,
        startsOn: '2026-09-01',
        endsOn: '2026-09-07',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  /**
   * O desafio nasce `DRAFT`, nao `ACTIVE`.
   *
   * Nascer aberto significaria que um erro de digitacao na meta ja esta
   * recebendo inscricao antes de alguem reler.
   */
  it('o desafio nasce em rascunho e precisa ser ativado', async () => {
    const { service, fake } = montar((f) => f.comTemplate(TEMPLATE));

    const { id } = await service.criar(CTX, {
      templateVersionId: 't-1',
      gymUnitId: null,
      title: 'x',
      targetValue: 5,
      startsOn: '2026-09-01',
      endsOn: '2026-09-07',
    });

    expect(fake.desafioDe(id)?.status).toBe('DRAFT');

    await service.ativar(CTX, id);

    expect(fake.desafioDe(id)?.status).toBe('ACTIVE');
  });

  it('recusa ativar duas vezes', async () => {
    const { service } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await expect(service.ativar(CTX, 'c-ativo')).rejects.toThrow(ConflictException);
  });
});

describe('paraOAluno', () => {
  /** ADR-048, Decisao 2: sem participacao, o aluno NAO esta inscrito. */
  it('sem participacao registrada, o desafio aparece como NAO inscrito', async () => {
    const { service } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    const lista = await service.paraOAluno(CTX, ALUNO, UNIDADE, '2026-09-05');

    expect(lista).toEqual([
      expect.objectContaining({ id: 'c-ativo', inscrito: false, progresso: 0 }),
    ]);
  });

  it('mostra o progresso de quem esta inscrito', async () => {
    const { service } = montar((f) =>
      f
        .comDesafio(DESAFIO_ATIVO)
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-03', '2026-09-05']),
    );

    const lista = await service.paraOAluno(CTX, ALUNO, UNIDADE, '2026-09-05');

    expect(lista[0]).toMatchObject({ inscrito: true, progresso: 3, meta: 8 });
  });

  /**
   * Treino FORA da janela nao conta.
   *
   * O filtro e do dominio (`progressoNoDesafio`), mas o teste vive aqui
   * tambem porque e a composicao que o aluno ve: dia de agosto no totem de
   * setembro seria progresso que ele nao fez neste desafio.
   */
  it('nao conta treino fora da janela do desafio', async () => {
    const { service } = montar((f) =>
      f
        .comDesafio(DESAFIO_ATIVO)
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-08-30', '2026-09-02', '2026-09-20']),
    );

    const lista = await service.paraOAluno(CTX, ALUNO, UNIDADE, '2026-09-05');

    expect(lista[0]?.progresso).toBe(1);
  });

  it('nao mostra desafio de outra unidade', async () => {
    const { service } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    const lista = await service.paraOAluno(CTX, ALUNO, 'outra-unidade', '2026-09-05');

    expect(lista).toEqual([]);
  });

  it('mostra desafio do tenant inteiro para qualquer unidade', async () => {
    const { service } = montar((f) =>
      f.comDesafio({ ...DESAFIO_ATIVO, id: 'c-global', gymUnitId: null }),
    );

    const lista = await service.paraOAluno(CTX, ALUNO, 'qualquer-unidade', '2026-09-05');

    expect(lista.map((d) => d.id)).toEqual(['c-global']);
  });

  it('nao mostra desafio em rascunho', async () => {
    const { service } = montar((f) => f.comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' }));

    expect(await service.paraOAluno(CTX, ALUNO, UNIDADE, '2026-09-05')).toEqual([]);
  });
});

describe('inscrever e sair (M5-FR-014)', () => {
  it('inscreve o aluno', async () => {
    const { service, fake } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await service.inscrever(CTX, 'c-ativo', ALUNO, '2026-09-05');

    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('JOINED');
  });

  it('recusa inscricao repetida', async () => {
    const { service } = montar((f) =>
      f.comDesafio(DESAFIO_ATIVO).comParticipacao('c-ativo', ALUNO, 'JOINED'),
    );

    await expect(service.inscrever(CTX, 'c-ativo', ALUNO, '2026-09-05')).rejects.toThrow(
      ConflictException,
    );
  });

  it('sair preserva o historico em vez de apagar a linha', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio(DESAFIO_ATIVO).comParticipacao('c-ativo', ALUNO, 'JOINED'),
    );

    await service.sair(CTX, 'c-ativo', ALUNO);

    // A linha CONTINUA existindo, com `LEFT` -- nao sumiu.
    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('LEFT');
  });

  it('quem saiu pode voltar, reusando a mesma linha', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio(DESAFIO_ATIVO).comParticipacao('c-ativo', ALUNO, 'LEFT'),
    );

    const antes = fake.participacaoDe('c-ativo', ALUNO)?.id;
    await service.inscrever(CTX, 'c-ativo', ALUNO, '2026-09-05');

    expect(fake.participacaoDe('c-ativo', ALUNO)).toMatchObject({
      id: antes,
      status: 'JOINED',
    });
  });

  it('sair de desafio em que nao esta inscrito nao falha', async () => {
    const { service } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await expect(service.sair(CTX, 'c-ativo', ALUNO)).resolves.toBeUndefined();
  });

  it('recusa inscricao em desafio inexistente', async () => {
    const { service } = montar();

    await expect(service.inscrever(CTX, 'nao-existe', ALUNO, '2026-09-05')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('encerrar', () => {
  it('conclui quem bateu a meta e reprova quem nao bateu', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 2 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comParticipacao('c-ativo', OUTRO_ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-02'])
        .comDiasTreinados(OUTRO_ALUNO, ['2026-09-01']),
    );

    const r = await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    expect(r).toEqual({ concluidos: 1, reprovados: 1 });
    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('COMPLETED');
    expect(fake.participacaoDe('c-ativo', OUTRO_ALUNO)?.status).toBe('FAILED');
  });

  it('grava um aviso por participante apurado', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 2 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comParticipacao('c-ativo', OUTRO_ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-02']),
    );

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    expect(fake.avisosGravados()).toEqual([
      { studentId: ALUNO, kind: 'CONCLUIDO', challengeId: 'c-ativo' },
      { studentId: OUTRO_ALUNO, kind: 'ENCERRADO_SEM_META', challengeId: 'c-ativo' },
    ]);
  });

  /**
   * IDEMPOTENCIA -- a razao da unique `(desafio, aluno, tipo)`.
   *
   * Sem ela, reprocessar o encerramento faz o aluno abrir o totem com a
   * mesma mensagem N vezes.
   */
  it('reprocessar o encerramento nao duplica aviso nem reapura participante', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 2 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-02']),
    );

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');
    const segunda = await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    // Na segunda passada nao ha mais ninguem `JOINED` para apurar.
    expect(segunda).toEqual({ concluidos: 0, reprovados: 0 });
    expect(fake.avisosGravados()).toHaveLength(1);
  });

  /**
   * Apuracao NO MEIO da janela conclui quem ja bateu, sem reprovar os outros
   * nem fechar o desafio -- quem ainda esta em curso continua tendo tempo.
   */
  it('apurar antes do fim conclui quem bateu e mantem os demais em curso', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 2 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comParticipacao('c-ativo', OUTRO_ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-02'])
        .comDiasTreinados(OUTRO_ALUNO, ['2026-09-01']),
    );

    const r = await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-05');

    expect(r).toEqual({ concluidos: 1, reprovados: 0 });
    expect(fake.participacaoDe('c-ativo', OUTRO_ALUNO)?.status).toBe('JOINED');
    expect(fake.desafioDe('c-ativo')?.status).toBe('ACTIVE');
  });

  it('fecha o desafio quando a janela terminou', async () => {
    const { service, fake } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    expect(fake.desafioDe('c-ativo')?.status).toBe('CLOSED');
  });

  it('quem saiu nao e apurado nem recebe aviso', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 2 })
        .comParticipacao('c-ativo', ALUNO, 'LEFT')
        .comDiasTreinados(ALUNO, ['2026-09-01', '2026-09-02']),
    );

    const r = await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    expect(r).toEqual({ concluidos: 0, reprovados: 0 });
    expect(fake.avisosGravados()).toEqual([]);
    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('LEFT');
  });
});

describe('avisos', () => {
  it('lista os avisos do aluno com o estado de leitura', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 1 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01']),
    );

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');
    const lista = await service.avisos(CTX, ALUNO);

    expect(lista).toEqual([
      expect.objectContaining({
        kind: 'CONCLUIDO',
        challengeTitle: 'Setembro em dia',
        lido: false,
      }),
    ]);
    expect(fake.avisosGravados()).toHaveLength(1);
  });

  it('marca aviso como lido', async () => {
    const { service } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 1 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01']),
    );

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');
    const [aviso] = await service.avisos(CTX, ALUNO);

    await service.marcarComoLidos(CTX, ALUNO, [aviso!.id]);

    expect((await service.avisos(CTX, ALUNO))[0]?.lido).toBe(true);
  });

  it('nao devolve aviso de outro aluno', async () => {
    const { service } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, targetValue: 1 })
        .comParticipacao('c-ativo', ALUNO, 'JOINED')
        .comDiasTreinados(ALUNO, ['2026-09-01']),
    );

    await service.encerrar(CTX, 'c-ativo', new Date(), '2026-09-15');

    expect(await service.avisos(CTX, OUTRO_ALUNO)).toEqual([]);
  });
});

describe('editar, excluir e cancelar', () => {
  it('edita titulo, meta e janela de desafio sem participante', async () => {
    const { service, fake } = montar((f) =>
      f.comTemplate(TEMPLATE).comDesafio(DESAFIO_ATIVO),
    );

    await service.editar(CTX, 'c-ativo', {
      title: 'Setembro forte',
      targetValue: 6,
      startsOn: '2026-09-01',
      endsOn: '2026-09-14',
    });

    expect(fake.desafioDe('c-ativo')).toMatchObject({
      title: 'Setembro forte',
      targetValue: 6,
    });
  });

  /**
   * O TETO E REVALIDADO NA EDICAO.
   *
   * Sem isto, editar seria caminho lateral para uma meta que a criacao
   * recusa -- cria com 8, edita para 30, e o `M5-BR-011` vira decoracao.
   */
  it('recusa edicao com meta acima do teto do modelo', async () => {
    const { service } = montar((f) => f.comTemplate(TEMPLATE).comDesafio(DESAFIO_ATIVO));

    await expect(
      service.editar(CTX, 'c-ativo', {
        title: 'Todo dia',
        targetValue: 30,
        startsOn: '2026-09-01',
        endsOn: '2026-09-14',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * PARTICIPANTE TRAVA A EDICAO (ADR-048).
   *
   * Mudar a meta depois que o aluno aceitou altera o combinado -- ele entrou
   * para bater 8 e acordaria tendo de bater outro numero.
   */
  it('recusa editar desafio em que alguem ja se inscreveu', async () => {
    const { service, fake } = montar((f) =>
      f
        .comTemplate(TEMPLATE)
        .comDesafio(DESAFIO_ATIVO)
        .comParticipacao('c-ativo', ALUNO, 'JOINED'),
    );

    await expect(
      service.editar(CTX, 'c-ativo', {
        title: 'Outro',
        targetValue: 4,
        startsOn: '2026-09-01',
        endsOn: '2026-09-14',
      }),
    ).rejects.toThrow(ConflictException);

    // E nada mudou.
    expect(fake.desafioDe('c-ativo')).toMatchObject({ title: 'Setembro em dia', targetValue: 8 });
  });

  /** Quem SAIU nao trava: nao ha compromisso a preservar. */
  it('permite editar quando o unico inscrito saiu', async () => {
    const { service, fake } = montar((f) =>
      f
        .comTemplate(TEMPLATE)
        .comDesafio(DESAFIO_ATIVO)
        .comParticipacao('c-ativo', ALUNO, 'LEFT'),
    );

    await service.editar(CTX, 'c-ativo', {
      title: 'Corrigido',
      targetValue: 5,
      startsOn: '2026-09-01',
      endsOn: '2026-09-14',
    });

    expect(fake.desafioDe('c-ativo')?.title).toBe('Corrigido');
  });

  it('exclui desafio sem participante', async () => {
    const { service, fake } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await service.excluir(CTX, 'c-ativo');

    expect(fake.desafioDe('c-ativo')).toBeUndefined();
  });

  /**
   * EXCLUIR APAGA EM CASCATA -- por isso participante trava.
   *
   * `M5-FR-014` manda manter o historico de quem participou; excluir levaria
   * a adesao e o aviso junto. Para esse caso existe cancelar.
   */
  it('recusa excluir desafio com participante e preserva a adesao', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio(DESAFIO_ATIVO).comParticipacao('c-ativo', ALUNO, 'JOINED'),
    );

    await expect(service.excluir(CTX, 'c-ativo')).rejects.toThrow(ConflictException);

    expect(fake.desafioDe('c-ativo')).toBeDefined();
    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('JOINED');
  });

  it('cancela desafio COM participante, preservando a adesao', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio(DESAFIO_ATIVO).comParticipacao('c-ativo', ALUNO, 'JOINED'),
    );

    await service.cancelar(CTX, 'c-ativo', new Date());

    expect(fake.desafioDe('c-ativo')?.status).toBe('CANCELLED');
    // A adesao CONTINUA -- e a diferenca entre cancelar e excluir.
    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('JOINED');
  });

  it('desafio cancelado some da lista do aluno', async () => {
    const { service } = montar((f) => f.comDesafio(DESAFIO_ATIVO));

    await service.cancelar(CTX, 'c-ativo', new Date());

    expect(await service.paraOAluno(CTX, ALUNO, UNIDADE, '2026-09-05')).toEqual([]);
  });

  it('recusa cancelar o que ja foi cancelado', async () => {
    const { service } = montar((f) =>
      f.comDesafio({ ...DESAFIO_ATIVO, status: 'CANCELLED' }),
    );

    await expect(service.cancelar(CTX, 'c-ativo', new Date())).rejects.toThrow(
      ConflictException,
    );
  });

  it('recusa editar ou excluir desafio inexistente', async () => {
    const { service } = montar();

    await expect(
      service.editar(CTX, 'nao-existe', {
        title: 'x',
        targetValue: 1,
        startsOn: '2026-09-01',
        endsOn: '2026-09-02',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(service.excluir(CTX, 'nao-existe')).rejects.toThrow(NotFoundException);
  });
});

describe('inscricao automatica ao abrir (emenda do ADR-048, 28/08/2026)', () => {
  it('inscreve todo aluno ativo e em dia ao abrir a inscricao', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' })
        .comAlunosElegiveis([ALUNO, OUTRO_ALUNO]),
    );

    await service.ativar(CTX, 'c-ativo');

    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('JOINED');
    expect(fake.participacaoDe('c-ativo', OUTRO_ALUNO)?.status).toBe('JOINED');
  });

  it('o desafio nasce com os inscritos ja contados', async () => {
    const { service } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' })
        .comAlunosElegiveis([ALUNO, OUTRO_ALUNO]),
    );

    await service.ativar(CTX, 'c-ativo');
    const [item] = await service.listar(CTX);

    expect(item?.participantes).toBe(2);
  });

  /**
   * QUEM SAIU NAO VOLTA.
   *
   * Reinscrever quem pediu para sair seria ignorar o pedido dele --
   * `M5-FR-014`. A linha `LEFT` existe justamente para isso.
   */
  it('nao reinscreve quem ja tinha saido', async () => {
    const { service, fake } = montar((f) =>
      f
        .comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' })
        .comParticipacao('c-ativo', ALUNO, 'LEFT')
        .comAlunosElegiveis([ALUNO, OUTRO_ALUNO]),
    );

    await service.ativar(CTX, 'c-ativo');

    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('LEFT');
    expect(fake.participacaoDe('c-ativo', OUTRO_ALUNO)?.status).toBe('JOINED');
  });

  it('abre normalmente quando nao ha aluno elegivel', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' }),
    );

    await service.ativar(CTX, 'c-ativo');

    expect(fake.desafioDe('c-ativo')?.status).toBe('ACTIVE');
    expect(fake.avisosGravados()).toEqual([]);
  });

  /**
   * O aluno inscrito automaticamente PODE SAIR (decisao do PI).
   *
   * Entrar sem pedir e uma coisa; ficar preso e outra.
   */
  it('o aluno inscrito automaticamente consegue sair', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' }).comAlunosElegiveis([ALUNO]),
    );

    await service.ativar(CTX, 'c-ativo');
    await service.sair(CTX, 'c-ativo', ALUNO);

    expect(fake.participacaoDe('c-ativo', ALUNO)?.status).toBe('LEFT');
  });

  /** Avisa cada inscrito de que o desafio comecou. */
  it('grava aviso DISPONIVEL para quem foi inscrito', async () => {
    const { service, fake } = montar((f) =>
      f.comDesafio({ ...DESAFIO_ATIVO, status: 'DRAFT' }).comAlunosElegiveis([ALUNO]),
    );

    await service.ativar(CTX, 'c-ativo');

    expect(fake.avisosGravados()).toEqual([
      { studentId: ALUNO, kind: 'DISPONIVEL', challengeId: 'c-ativo' },
    ]);
  });
});
