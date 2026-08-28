import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const TENANT = 'tenant-a';
const UNIDADE_A = 'unidade-a';
const UNIDADE_B = 'unidade-b';

/**
 * Escopo de unidade nas contestacoes -- F35.
 *
 * `ajustarXp` (F31) ja barra gerente restrito a uma unidade de mexer em aluno
 * de outra. Resolver contestacao com desfecho CORRIGIDA ADMITE que houve
 * correcao de saldo -- e o mesmo ato visto do outro lado, entao herda a mesma
 * guarda. Sem ela, o gerente da unidade A fecharia a contestacao de um aluno
 * da unidade B, com resposta 200.
 */
describe('EngagementService -- escopo de unidade nas contestacoes (F35)', () => {
  let porta: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    porta = new RepositorioEmMemoria();
    service = new EngagementService(porta);
    porta.cadastrarAluno({
      id: 'aluno-a',
      tenantId: TENANT,
      name: 'Ana',
      status: 'ACTIVE',
      gymUnitId: UNIDADE_A,
    });
    porta.cadastrarAluno({
      id: 'aluno-b',
      tenantId: TENANT,
      name: 'Bruno',
      status: 'ACTIVE',
      gymUnitId: UNIDADE_B,
    });
  });

  const soUnidadeA = new Set([UNIDADE_A]);

  it('a fila do gerente restrito mostra so a unidade dele', async () => {
    await service.abrirContestacao(TENANT, 'aluno-a', {
      subject: 'XP',
      descricao: 'Contestacao da unidade A.',
    });
    await service.abrirContestacao(TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao da unidade B.',
    });

    const fila = await service.listarContestacoes(TENANT, 'ABERTA', soUnidadeA);

    expect(fila).toHaveLength(1);
    expect(fila[0]?.alunoNome).toBe('Ana');
  });

  it('quem tem o tenant inteiro ve as duas unidades', async () => {
    await service.abrirContestacao(TENANT, 'aluno-a', {
      subject: 'XP',
      descricao: 'Contestacao da unidade A.',
    });
    await service.abrirContestacao(TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao da unidade B.',
    });

    expect(await service.listarContestacoes(TENANT, 'ABERTA', 'ALL')).toHaveLength(2);
  });

  it('O CANARIO: gerente restrito NAO resolve contestacao de outra unidade', async () => {
    const daOutra = await service.abrirContestacao(TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao da unidade B.',
    });

    await expect(
      service.resolverContestacao(
        TENANT,
        daOutra.id,
        { desfecho: 'CORRIGIDA', resolucao: 'nao deveria conseguir' },
        'moderador-a',
        new Date(),
        null,
        soUnidadeA,
      ),
    ).rejects.toMatchObject({ response: { code: 'CONTESTACAO_NAO_ENCONTRADA' } });

    // E continua aberta -- a recusa nao pode ter efeito colateral.
    expect(await service.listarContestacoes(TENANT, 'ABERTA', 'ALL')).toHaveLength(1);
  });

  it('a mensagem NAO distingue "de outra unidade" de "nao existe"', async () => {
    // Mesmo padrao de `ajustarXp`/`ALUNO_NAO_ENCONTRADO`: a diferenca entre as
    // duas respostas denunciaria a existencia da contestacao alheia.
    const daOutra = await service.abrirContestacao(TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao da unidade B.',
    });

    const deOutraUnidade = service.resolverContestacao(
      TENANT,
      daOutra.id,
      { desfecho: 'CORRIGIDA', resolucao: 'x' },
      'moderador-a',
      new Date(),
      null,
      soUnidadeA,
    );
    const inexistente = service.resolverContestacao(
      TENANT,
      '00000000-0000-4000-8000-000000000000',
      { desfecho: 'CORRIGIDA', resolucao: 'x' },
      'moderador-a',
      new Date(),
      null,
      soUnidadeA,
    );

    await expect(deOutraUnidade).rejects.toMatchObject({
      response: { code: 'CONTESTACAO_NAO_ENCONTRADA' },
    });
    await expect(inexistente).rejects.toMatchObject({
      response: { code: 'CONTESTACAO_NAO_ENCONTRADA' },
    });
  });

  it('o gerente restrito resolve a da PROPRIA unidade', async () => {
    const daPropria = await service.abrirContestacao(TENANT, 'aluno-a', {
      subject: 'XP',
      descricao: 'Contestacao da unidade A.',
    });

    const resolvida = await service.resolverContestacao(
      TENANT,
      daPropria.id,
      { desfecho: 'CORRIGIDA', resolucao: 'Devolvidos 10 pontos.' },
      'moderador-a',
      new Date(),
      null,
      soUnidadeA,
    );

    expect(resolvida.status).toBe('CORRIGIDA');
  });
});
