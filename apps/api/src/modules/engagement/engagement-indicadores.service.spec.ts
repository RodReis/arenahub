import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const TENANT = 'tenant-a';
const OUTRO_TENANT = 'tenant-b';

describe('EngagementService.indicadores -- painel de operacao (F35, M5-FR-018)', () => {
  let porta: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    porta = new RepositorioEmMemoria();
    service = new EngagementService(porta);
  });

  it('academia sem nada devolve zeros, nao erro', async () => {
    // Painel de academia recem-ligada tem de abrir. Zero e um numero; a
    // ausencia de dado nao e falha.
    const indicadores = await service.indicadores(TENANT);

    expect(indicadores).toEqual({
      alunosAtivos: 0,
      participandoDoRanking: 0,
      optOut: 0,
      apelidosPendentes: 0,
      apelidosOcultos: 0,
      contestacoesAbertas: 0,
    });
  });

  it('conta quem participa e quem saiu -- ausencia de linha e PARTICIPA', async () => {
    // INV-154: no engajamento, ausencia de ConsentRecord significa que o
    // aluno PARTICIPA. Contar so quem tem linha ACCEPTED daria quase zero
    // participando numa academia inteira, e o painel mentiria feio.
    porta.cadastrarAluno({ id: 'a1', tenantId: TENANT, name: 'Ana', status: 'ACTIVE' });
    porta.cadastrarAluno({ id: 'a2', tenantId: TENANT, name: 'Bruno', status: 'ACTIVE' });
    porta.cadastrarAluno({ id: 'a3', tenantId: TENANT, name: 'Caio', status: 'ACTIVE' });
    porta.publicarDocumento(TENANT, 'RANKING');
    await porta.registrarDecisao(
      {
        tenantId: TENANT,
        actorId: 'user-1',
        studentId: 'a3',
        finalidade: 'RANKING',
        decision: 'REFUSED',
        subjectAgeYears: 30,
      },
      new Date(),
    );

    const indicadores = await service.indicadores(TENANT);

    expect(indicadores.alunosAtivos).toBe(3);
    expect(indicadores.participandoDoRanking).toBe(2);
    expect(indicadores.optOut).toBe(1);
  });

  it('aluno INATIVO nao entra na conta -- ele nunca aparece em exposicao', async () => {
    // INV-155: `Student.status` != ACTIVE vence tudo. Conta-lo como
    // participante inflaria o denominador de toda taxa do painel.
    porta.cadastrarAluno({ id: 'a1', tenantId: TENANT, name: 'Ana', status: 'ACTIVE' });
    porta.cadastrarAluno({ id: 'a2', tenantId: TENANT, name: 'Bruno', status: 'SUSPENDED' });

    const indicadores = await service.indicadores(TENANT);

    expect(indicadores.alunosAtivos).toBe(1);
    expect(indicadores.participandoDoRanking).toBe(1);
  });

  it('conta a fila de apelidos e os ocultos', async () => {
    porta.cadastrarAluno({ id: 'a1', tenantId: TENANT, name: 'Ana', status: 'ACTIVE' });
    await porta.salvarPerfil(
      {
        tenantId: TENANT,
        studentId: 'a1',
        identityChoice: 'APELIDO',
        alias: 'Aninha',
        aliasNormalized: 'aninha',
        screeningSignals: [],
        version: null,
      },
      new Date(),
    );

    expect((await service.indicadores(TENANT)).apelidosPendentes).toBe(1);
  });

  it('conta as contestacoes ABERTAS, nao as resolvidas', async () => {
    // O painel mede o que a secretaria ainda precisa fazer. Somar as
    // resolvidas faria o numero so crescer e nunca voltar a zero.
    porta.cadastrarAluno({ id: 'a1', tenantId: TENANT, name: 'Ana', status: 'ACTIVE' });

    const primeira = await service.abrirContestacao(TENANT, 'a1', {
      subject: 'XP',
      descricao: 'Faltaram pontos da semana.',
    });
    await service.abrirContestacao(TENANT, 'a1', {
      subject: 'RANKING',
      descricao: 'Minha posicao esta errada.',
    });

    expect((await service.indicadores(TENANT)).contestacoesAbertas).toBe(2);

    await service.resolverContestacao(
      TENANT,
      primeira.id,
      { desfecho: 'IMPROCEDENTE', resolucao: 'A catraca nao registrou passagem.' },
      'user-1',
      new Date(),
    );

    expect((await service.indicadores(TENANT)).contestacoesAbertas).toBe(1);
  });

  it('O CANARIO DE TENANT: os indicadores de um nao somam o outro', async () => {
    porta.cadastrarAluno({ id: 'a1', tenantId: TENANT, name: 'Ana', status: 'ACTIVE' });
    porta.cadastrarAluno({ id: 'b1', tenantId: OUTRO_TENANT, name: 'Bruno', status: 'ACTIVE' });
    await service.abrirContestacao(OUTRO_TENANT, 'b1', {
      subject: 'XP',
      descricao: 'Contestacao do outro tenant.',
    });

    const indicadores = await service.indicadores(TENANT);

    expect(indicadores.alunosAtivos).toBe(1);
    expect(indicadores.contestacoesAbertas).toBe(0);
  });
});
