import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementXpService } from './engagement-xp.service.js';
import { FakePortaDeXp } from './engagement-xp.repository.fake.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const TENANT = 'tenant-a';
const UNIDADE = 'unidade-1';
const ALUNO = 'aluno-1';

function contexto(): TenantContext {
  return {
    tenantId: TENANT,
    actorId: 'ator-1',
    sessionId: 'sessao-1',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };
}

describe('EngagementXpService.ajustarXp -- teto de correcao (F35)', () => {
  let porta: FakePortaDeXp;
  let service: EngagementXpService;

  beforeEach(() => {
    porta = new FakePortaDeXp();
    service = new EngagementXpService(porta);
    porta.comAluno(ALUNO, 'America/Sao_Paulo', UNIDADE);
    porta.comRegra({ points: 10 });
  });

  it('aplica a correcao dentro do teto', async () => {
    porta.comTetoDeCorrecao(100);

    await service.ajustarXp(
      contexto(),
      ALUNO,
      { pontos: 50, motivo: 'Sessao de terca nao sincronizou.', idempotencyKey: 'k1' },
      new Date('2026-08-20T12:00:00Z'),
    );

    expect(await porta.saldoDoAluno(contexto(), ALUNO, '2026-08')).toBe(50);
  });

  it('RECUSA acima do teto, e NAO grava nada no ledger', async () => {
    // O ledger e append-only: uma linha gravada antes da checagem nunca sairia
    // de la. A guarda tem de vir ANTES da escrita, nao depois.
    porta.comTetoDeCorrecao(100);

    await expect(
      service.ajustarXp(
        contexto(),
        ALUNO,
        { pontos: 500, motivo: 'devolucao grande', idempotencyKey: 'k2' },
        new Date('2026-08-20T12:00:00Z'),
      ),
    ).rejects.toMatchObject({ response: { code: 'CORRECAO_ACIMA_DO_TETO' } });

    expect(await porta.saldoDoAluno(contexto(), ALUNO, '2026-08')).toBe(0);
  });

  it('RECUSA retirada acima do teto -- tirar 500 e tao grave quanto dar 500', async () => {
    // O canario que atravessa service e dominio: comparar sem valor absoluto
    // deixaria isto passar, e zerar o saldo de um aluno seria a operacao MENOS
    // controlada do sistema.
    porta.comTetoDeCorrecao(100);

    await expect(
      service.ajustarXp(
        contexto(),
        ALUNO,
        { pontos: -500, motivo: 'retirada grande', idempotencyKey: 'k3' },
        new Date('2026-08-20T12:00:00Z'),
      ),
    ).rejects.toMatchObject({ response: { code: 'CORRECAO_ACIMA_DO_TETO' } });

    expect(await porta.saldoDoAluno(contexto(), ALUNO, '2026-08')).toBe(0);
  });

  it('tenant sem teto configurado aplica qualquer correcao', async () => {
    // `null` e o estado de TODOS os tenants hoje: a coluna nasce nula. Tratar
    // nulo como zero barraria toda correcao em toda academia.
    porta.comTetoDeCorrecao(null);

    await service.ajustarXp(
      contexto(),
      ALUNO,
      { pontos: 9999, motivo: 'sem teto configurado', idempotencyKey: 'k4' },
      new Date('2026-08-20T12:00:00Z'),
    );

    expect(await porta.saldoDoAluno(contexto(), ALUNO, '2026-08')).toBe(9999);
  });

  it('a correcao no limite exato passa', async () => {
    porta.comTetoDeCorrecao(100);

    await service.ajustarXp(
      contexto(),
      ALUNO,
      { pontos: 100, motivo: 'no limite', idempotencyKey: 'k5' },
      new Date('2026-08-20T12:00:00Z'),
    );

    expect(await porta.saldoDoAluno(contexto(), ALUNO, '2026-08')).toBe(100);
  });
});
