import { beforeEach, describe, expect, it } from '@jest/globals';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const CTX = {
  tenantId: 't1',
  actorId: 'u1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: new Set(['g1']),
};
const AGORA = new Date('2026-08-27T12:00:00.000Z');

describe('EngagementService -- preferencias', () => {
  let repo: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    // Instancia NOVA por teste: dublê com estado vaza entre casos.
    repo = new RepositorioEmMemoria();
    service = new EngagementService(repo);
    repo.cadastrarAluno({ id: 'a1', tenantId: 't1', name: 'Ana Souza', status: 'ACTIVE' });
    repo.publicarDocumento('t1', 'RANKING');
  });

  it('aluno sem manifestacao aparece participando de todas as finalidades', async () => {
    const preferencias = await service.obterPreferencias(CTX, 'a1');
    expect(preferencias.finalidades.RANKING).toBe(true);
    expect(preferencias.nomeExibido).toBe('Ana');
  });

  it('sair do ranking grava REFUSED e passa a nao participar', async () => {
    await service.atualizarPreferencia(
      CTX,
      { studentId: 'a1', finalidade: 'RANKING', participa: false, idempotencyKey: 'k1' },
      AGORA,
    );
    const preferencias = await service.obterPreferencias(CTX, 'a1');
    expect(preferencias.finalidades.RANKING).toBe(false);
  });

  it('voltar ao ranking substitui a decisao anterior, sem apagar', async () => {
    const sair = { studentId: 'a1', finalidade: 'RANKING' as const, participa: false };
    const voltar = { studentId: 'a1', finalidade: 'RANKING' as const, participa: true };
    await service.atualizarPreferencia(CTX, { ...sair, idempotencyKey: 'k1' }, AGORA);
    await service.atualizarPreferencia(CTX, { ...voltar, idempotencyKey: 'k2' }, AGORA);

    expect((await service.obterPreferencias(CTX, 'a1')).finalidades.RANKING).toBe(true);
    // INV-021: a decisao anterior continua existindo, marcada como substituida.
    const decisoes = repo.decisoesDe('a1', 'RANKING');
    expect(decisoes).toHaveLength(2);

    // `toHaveLength` acima ja garante o elemento; o `if` existe para o
    // compilador, e lanca em vez de virar `?.` -- um encadeamento opcional
    // aqui faria a asserção sumir calada se a lista viesse vazia.
    const anterior = decisoes[0];
    if (!anterior) throw new Error('esperava a decisao anterior na posicao 0');

    expect(anterior.supersededAt).toEqual(AGORA);
  });

  it('mesma Idempotency-Key nao cria segunda linha', async () => {
    const entrada = {
      studentId: 'a1',
      finalidade: 'RANKING' as const,
      participa: false,
      idempotencyKey: 'k1',
    };
    await service.atualizarPreferencia(CTX, entrada, AGORA);
    await service.atualizarPreferencia(CTX, entrada, AGORA);
    expect(repo.decisoesDe('a1', 'RANKING')).toHaveLength(1);
  });

  it('nao le nem escreve preferencia de aluno de outro tenant', async () => {
    repo.cadastrarAluno({ id: 'a9', tenantId: 't2', name: 'Bruno Lima', status: 'ACTIVE' });
    await expect(service.obterPreferencias(CTX, 'a9')).rejects.toThrow(NotFoundException);
  });

  it('registrar decisao sem documento publicado falha com codigo estavel', async () => {
    // CHALLENGE nao foi publicado no beforeEach -- so RANKING foi.
    await expect(
      service.atualizarPreferencia(
        CTX,
        { studentId: 'a1', finalidade: 'CHALLENGE', participa: false, idempotencyKey: 'k1' },
        AGORA,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('EngagementService -- alias publico', () => {
  let repo: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    repo = new RepositorioEmMemoria();
    service = new EngagementService(repo);
    repo.cadastrarAluno({ id: 'a1', tenantId: 't1', name: 'Ana Souza', status: 'ACTIVE' });
  });

  it('alias novo nasce PENDING, mesmo limpo', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    expect(perfil.status).toBe('PENDING');
    expect(perfil.screeningSignals).toEqual([]);
  });

  it('alias suspeito vai para revisao humana COM sinal, nao rejeitado', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'ana@exemplo.com', version: null },
      AGORA,
    );
    expect(perfil.status).toBe('PENDING');
    expect(perfil.screeningSignals).toContain('PARECE_EMAIL');
  });

  it('enquanto pendente, o nome exibido continua sendo o primeiro nome', async () => {
    await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    expect((await service.obterPreferencias(CTX, 'a1')).nomeExibido).toBe('Ana');
  });

  it('aprovado, o apelido passa a ser o nome exibido', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: perfil.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );
    expect((await service.obterPreferencias(CTX, 'a1')).nomeExibido).toBe('Tigre');
  });

  it('editar alias aprovado devolve o perfil a PENDING', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: perfil.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );
    const atual = await service.obterPreferencias(CTX, 'a1');
    const editado = await service.definirAliasPublico(
      CTX,
      {
        studentId: 'a1',
        identityChoice: 'APELIDO',
        alias: 'Leao',
        version: atual.perfil?.version ?? null,
      },
      AGORA,
    );
    expect(editado.status).toBe('PENDING');
  });

  it('versao velha e recusada -- compare-and-swap', async () => {
    await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await expect(
      service.definirAliasPublico(
        CTX,
        { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Leao', version: 99 },
        AGORA,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('moderador nao alcanca perfil de outro tenant', async () => {
    repo.cadastrarAluno({ id: 'a9', tenantId: 't2', name: 'Bruno Lima', status: 'ACTIVE' });
    const alheio = await service.definirAliasPublico(
      { ...CTX, tenantId: 't2' },
      { studentId: 'a9', identityChoice: 'APELIDO', alias: 'Lobo', version: null },
      AGORA,
    );
    await expect(
      service.moderarAlias(
        CTX,
        { perfilId: alheio.id, decisao: 'APPROVED', rejectionReason: null },
        AGORA,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejeitar com razao fora do enum falha com BadRequestException', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await expect(
      service.moderarAlias(
        CTX,
        {
          perfilId: perfil.id,
          decisao: 'REJECTED',
          // Fora do enum AliasRejectionReason -- string arbitraria vinda de
          // um chamador que nao validou antes.
          rejectionReason: 'MOTIVO_INVENTADO' as never,
        },
        AGORA,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('aprovar alias que so difere em caixa do ja aprovado colide -- ConflictException', async () => {
    repo.cadastrarAluno({ id: 'a2', tenantId: 't1', name: 'Bruno Lima', status: 'ACTIVE' });

    const primeiro = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: primeiro.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );

    const segundo = await service.definirAliasPublico(
      CTX,
      { studentId: 'a2', identityChoice: 'APELIDO', alias: 'TIGRE', version: null },
      AGORA,
    );

    // O indice real e sobre `alias_normalized` (NFKC + minuscula): "Tigre" e
    // "TIGRE" normalizam para o mesmo valor e devem colidir aqui tambem --
    // um dublê que comparasse o texto cru deixaria os dois coexistirem.
    await expect(
      service.moderarAlias(
        CTX,
        { perfilId: segundo.id, decisao: 'APPROVED', rejectionReason: null },
        AGORA,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('aprovar alias que so difere em espaco do ja aprovado colide -- ConflictException', async () => {
    repo.cadastrarAluno({ id: 'a3', tenantId: 't1', name: 'Carla Dias', status: 'ACTIVE' });

    const primeiro = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Leao', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: primeiro.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );

    const segundo = await service.definirAliasPublico(
      CTX,
      { studentId: 'a3', identityChoice: 'APELIDO', alias: '  Leao  ', version: null },
      AGORA,
    );

    // `triarAlias` colapsa espaco nas pontas e no meio -- "Leao" e "  Leao  "
    // normalizam igual e devem colidir na aprovacao.
    await expect(
      service.moderarAlias(
        CTX,
        { perfilId: segundo.id, decisao: 'APPROVED', rejectionReason: null },
        AGORA,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
