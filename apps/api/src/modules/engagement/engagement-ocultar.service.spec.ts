import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';
import { resolverExposicao } from './domain/exposicao.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const TENANT = 'tenant-a';
const ALUNO = 'aluno-1';

function contexto(): TenantContext {
  return {
    tenantId: TENANT,
    actorId: 'moderador-1',
    sessionId: 's1',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };
}

describe('EngagementService.moderarAlias -- ocultar (F35)', () => {
  let porta: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    porta = new RepositorioEmMemoria();
    service = new EngagementService(porta);
    porta.cadastrarAluno({ id: ALUNO, tenantId: TENANT, name: 'Ana Souza', status: 'ACTIVE' });
  });

  async function comApelidoAprovado(): Promise<string> {
    const perfil = await service.definirAliasPublico(
      contexto(),
      { studentId: ALUNO, identityChoice: 'APELIDO', alias: 'Aninha', version: null },
      new Date(),
    );

    await service.moderarAlias(
      contexto(),
      { perfilId: perfil.id, decisao: 'APPROVED', rejectionReason: null },
      new Date(),
    );

    return perfil.id;
  }

  it('OCULTA um apelido ja aprovado -- HIDDEN deixa de ser estado orfao', async () => {
    // A F30 criou `HIDDEN` sem NENHUM caminho de escrita, esperando esta
    // fatia (ADR-046 Decisao 6). Antes disto, o estado era inalcancavel.
    const perfilId = await comApelidoAprovado();

    const oculto = await service.moderarAlias(
      contexto(),
      { perfilId, decisao: 'HIDDEN', rejectionReason: 'OFENSIVO' },
      new Date(),
    );

    expect(oculto.status).toBe('HIDDEN');
  });

  it('apelido oculto NAO aparece na exposicao -- cai no primeiro nome', () => {
    // `resolverExposicao` nao muda com a F35: ela ja tratava qualquer status
    // != APPROVED. Este teste trava esse contrato para o estado que agora
    // e alcancavel de verdade.
    const exposicao = resolverExposicao({
      decisao: null,
      perfil: { alias: 'Aninha', status: 'HIDDEN', identidade: 'APELIDO' },
      primeiroNome: 'Ana',
      statusDoAluno: 'ACTIVE',
    });

    expect(exposicao).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('ocultar exige razao, como rejeitar -- ocultar sem motivo e ato sem trilha', async () => {
    const perfilId = await comApelidoAprovado();

    await expect(
      service.moderarAlias(
        contexto(),
        { perfilId, decisao: 'HIDDEN', rejectionReason: null },
        new Date(),
      ),
    ).rejects.toMatchObject({ response: { code: 'RAZAO_DE_RECUSA_OBRIGATORIA' } });
  });

  it('o aluno reeditar o apelido tira do HIDDEN e devolve para a fila', async () => {
    // Comportamento herdado da F30 (`salvarPerfil` sempre grava PENDING), e
    // ele tem de continuar valendo: ocultar nao pode ser banimento definitivo
    // sem caminho de volta.
    const perfilId = await comApelidoAprovado();
    await service.moderarAlias(
      contexto(),
      { perfilId, decisao: 'HIDDEN', rejectionReason: 'OFENSIVO' },
      new Date(),
    );

    const reeditado = await service.definirAliasPublico(
      contexto(),
      { studentId: ALUNO, identityChoice: 'APELIDO', alias: 'Ana S', version: null },
      new Date(),
    );

    expect(reeditado.status).toBe('PENDING');
  });
});
