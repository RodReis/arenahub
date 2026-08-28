import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const TENANT = 'tenant-a';
const OUTRO_TENANT = 'tenant-b';
const ALUNO = 'aluno-1';
const MODERADOR = 'user-1';

describe('EngagementService -- contestacoes (F35)', () => {
  let porta: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    porta = new RepositorioEmMemoria();
    service = new EngagementService(porta);
    porta.cadastrarAluno({ id: ALUNO, tenantId: TENANT, name: 'Ana Souza', status: 'ACTIVE' });
  });

  it('abre contestacao e ela aparece na fila do painel', async () => {
    await service.abrirContestacao(TENANT, ALUNO, {
      subject: 'XP',
      descricao: 'Treinei terca e nao pontuou.',
    });

    const fila = await service.listarContestacoes(TENANT, 'ABERTA');

    expect(fila).toHaveLength(1);
    expect(fila[0]?.subject).toBe('XP');
    expect(fila[0]?.alunoNome).toBe('Ana Souza');
  });

  it('recusa descricao curta antes de gravar', async () => {
    await expect(
      service.abrirContestacao(TENANT, ALUNO, { subject: 'XP', descricao: 'ue' }),
    ).rejects.toMatchObject({ response: { code: 'CONTESTACAO_DESCRICAO_CURTA' } });

    expect(await service.listarContestacoes(TENANT, 'ABERTA')).toHaveLength(0);
  });

  it('resolve como IMPROCEDENTE e sai da fila de abertas', async () => {
    const criada = await service.abrirContestacao(TENANT, ALUNO, {
      subject: 'RANKING',
      descricao: 'Minha posicao esta errada.',
    });

    await service.resolverContestacao(
      TENANT,
      criada.id,
      { desfecho: 'IMPROCEDENTE', resolucao: 'A coorte do mes ficou abaixo do minimo.' },
      MODERADOR,
      new Date('2026-08-20T12:00:00Z'),
    );

    expect(await service.listarContestacoes(TENANT, 'ABERTA')).toHaveLength(0);
    expect(await service.listarContestacoes(TENANT, 'IMPROCEDENTE')).toHaveLength(1);
  });

  it('exige resolucao mesmo no desfecho IMPROCEDENTE', async () => {
    const criada = await service.abrirContestacao(TENANT, ALUNO, {
      subject: 'XP',
      descricao: 'Faltaram pontos da semana passada.',
    });

    await expect(
      service.resolverContestacao(
        TENANT,
        criada.id,
        { desfecho: 'IMPROCEDENTE', resolucao: '   ' },
        MODERADOR,
        new Date(),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONTESTACAO_RESOLUCAO_OBRIGATORIA' } });
  });

  it('recusa resolver duas vezes -- a segunda apagaria o ator da primeira', async () => {
    const criada = await service.abrirContestacao(TENANT, ALUNO, {
      subject: 'XP',
      descricao: 'Faltaram pontos da semana passada.',
    });

    await service.resolverContestacao(
      TENANT,
      criada.id,
      { desfecho: 'CORRIGIDA', resolucao: 'Devolvidos 10 pontos.' },
      MODERADOR,
      new Date(),
    );

    await expect(
      service.resolverContestacao(
        TENANT,
        criada.id,
        { desfecho: 'IMPROCEDENTE', resolucao: 'mudei de ideia' },
        'user-2',
        new Date(),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONTESTACAO_JA_RESOLVIDA' } });
  });

  it('O CANARIO DE TENANT: nao resolve contestacao de outro tenant', async () => {
    // O `tenantId` no `where` da escrita e o que separa as academias. Sem ele,
    // um moderador do tenant A fecharia a contestacao de um aluno do tenant B
    // -- e a resposta seria 200, nao erro.
    porta.cadastrarAluno({ id: 'aluno-b', tenantId: OUTRO_TENANT, name: 'Bruno Lima', status: 'ACTIVE' });
    const doOutro = await service.abrirContestacao(OUTRO_TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao do outro tenant.',
    });

    await expect(
      service.resolverContestacao(
        TENANT,
        doOutro.id,
        { desfecho: 'IMPROCEDENTE', resolucao: 'nao deveria conseguir' },
        MODERADOR,
        new Date(),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONTESTACAO_NAO_ENCONTRADA' } });

    expect(await service.listarContestacoes(OUTRO_TENANT, 'ABERTA')).toHaveLength(1);
  });

  it('a fila de um tenant nunca mostra contestacao de outro', async () => {
    porta.cadastrarAluno({ id: 'aluno-b', tenantId: OUTRO_TENANT, name: 'Bruno Lima', status: 'ACTIVE' });
    await service.abrirContestacao(OUTRO_TENANT, 'aluno-b', {
      subject: 'XP',
      descricao: 'Contestacao do outro tenant.',
    });

    expect(await service.listarContestacoes(TENANT, 'ABERTA')).toHaveLength(0);
  });

  it('o aluno so ve as proprias contestacoes', async () => {
    porta.cadastrarAluno({ id: 'aluno-2', tenantId: TENANT, name: 'Carlos Dias', status: 'ACTIVE' });
    await service.abrirContestacao(TENANT, ALUNO, {
      subject: 'XP',
      descricao: 'Contestacao da Ana.',
    });
    await service.abrirContestacao(TENANT, 'aluno-2', {
      subject: 'XP',
      descricao: 'Contestacao do Carlos.',
    });

    const daAna = await service.contestacoesDoAluno(TENANT, ALUNO);

    expect(daAna).toHaveLength(1);
    expect(daAna[0]?.descricao).toBe('Contestacao da Ana.');
  });
});
