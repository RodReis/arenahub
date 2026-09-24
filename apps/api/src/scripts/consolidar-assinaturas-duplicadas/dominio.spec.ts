import { describe, expect, it } from '@jest/globals';

import { decidirConsolidacaoDoAluno, type AssinaturaParaConsolidar } from './dominio.js';

const AGORA = new Date('2026-09-24T12:00:00Z');

function assinatura(
  id: string,
  status: AssinaturaParaConsolidar['status'],
  startsAt: string,
  entitlements: AssinaturaParaConsolidar['entitlements'] = [],
): AssinaturaParaConsolidar {
  return { id, status, startsAt: new Date(startsAt), entitlements };
}

function entitlementValido(id: string): AssinaturaParaConsolidar['entitlements'][number] {
  return { id, status: 'ACTIVE', startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-10-01T00:00:00Z') };
}

function entitlementVencido(id: string): AssinaturaParaConsolidar['entitlements'][number] {
  return { id, status: 'ACTIVE', startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-02-01T00:00:00Z') };
}

describe('decidirConsolidacaoDoAluno', () => {
  it('NADA_A_FAZER quando o aluno tem so uma assinatura', () => {
    const veredito = decidirConsolidacaoDoAluno([assinatura('a1', 'ACTIVE', '2026-01-01')], AGORA);
    expect(veredito).toEqual({ tipo: 'NADA_A_FAZER', motivo: 'UMA_SO_ASSINATURA' });
  });

  it('NADA_A_FAZER quando ha DUAS ou mais ACTIVE -- nunca escolhe entre elas', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [assinatura('a1', 'ACTIVE', '2026-01-01'), assinatura('a2', 'ACTIVE', '2026-06-01')],
      AGORA,
    );
    expect(veredito).toEqual({ tipo: 'NADA_A_FAZER', motivo: 'DUAS_OU_MAIS_ACTIVE' });
  });

  it('sobrevive a ACTIVE quando ha exatamente uma, mesmo nao sendo a mais recente', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('antiga-active', 'ACTIVE', '2026-01-01'),
        assinatura('recente-cancelada', 'CANCELLED', '2026-08-01'),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      expect(veredito.sobreviventeId).toBe('antiga-active');
      expect(veredito.criterioDeSobrevivencia).toBe('ACTIVE');
      expect(veredito.encerrar).toEqual([{ assinaturaId: 'recente-cancelada', entitlementParaMigrar: null }]);
    }
  });

  it('sobrevive a mais recente quando nenhuma e ACTIVE', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('mais-antiga', 'CANCELLED', '2026-01-01'),
        assinatura('mais-recente', 'EXPIRED', '2026-06-01'),
        assinatura('do-meio', 'CANCELLED', '2026-03-01'),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      expect(veredito.sobreviventeId).toBe('mais-recente');
      expect(veredito.criterioDeSobrevivencia).toBe('MAIS_RECENTE');
      expect(veredito.encerrar.map((e) => e.assinaturaId).sort()).toEqual(['do-meio', 'mais-antiga']);
    }
  });

  it('CASO DE RISCO: entitlement ativo-e-valido de uma assinatura encerrada MIGRA quando a sobrevivente nao tem nenhum', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('sobrevivente', 'ACTIVE', '2026-06-01', []),
        assinatura('encerrada-com-acesso', 'EXPIRED', '2026-01-01', [entitlementValido('ent-risco')]),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      expect(veredito.encerrar).toEqual([
        { assinaturaId: 'encerrada-com-acesso', entitlementParaMigrar: 'ent-risco' },
      ]);
    }
  });

  it('NAO migra quando a sobrevivente JA TEM entitlement ACTIVE proprio -- evita 2 ACTIVE simultaneos', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('sobrevivente', 'ACTIVE', '2026-06-01', [entitlementValido('ent-da-sobrevivente')]),
        assinatura('encerrada-com-acesso', 'EXPIRED', '2026-01-01', [entitlementValido('ent-risco')]),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      // O entitlement de risco NAO migra -- fica para ser revogado normalmente,
      // porque a sobrevivente ja da acesso por conta propria.
      expect(veredito.encerrar).toEqual([
        { assinaturaId: 'encerrada-com-acesso', entitlementParaMigrar: null },
      ]);
    }
  });

  it('NAO migra entitlement ja vencido -- so o valido AGORA conta como risco', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('sobrevivente', 'ACTIVE', '2026-06-01', []),
        assinatura('encerrada-vencida', 'EXPIRED', '2026-01-01', [entitlementVencido('ent-vencido')]),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      expect(veredito.encerrar).toEqual([{ assinaturaId: 'encerrada-vencida', entitlementParaMigrar: null }]);
    }
  });

  it('NAO migra entitlement que nao esta ACTIVE (ex.: SUSPENDED)', () => {
    const suspenso: AssinaturaParaConsolidar['entitlements'][number] = {
      id: 'ent-suspenso',
      status: 'SUSPENDED',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2026-10-01T00:00:00Z'),
    };

    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('sobrevivente', 'ACTIVE', '2026-06-01', []),
        assinatura('encerrada', 'EXPIRED', '2026-01-01', [suspenso]),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      expect(veredito.encerrar).toEqual([{ assinaturaId: 'encerrada', entitlementParaMigrar: null }]);
    }
  });

  it('tres assinaturas, sobrevivente ACTIVE sem entitlement -- so uma das duas encerradas tem risco', () => {
    const veredito = decidirConsolidacaoDoAluno(
      [
        assinatura('sobrevivente', 'ACTIVE', '2026-06-01', []),
        assinatura('encerrada-1-com-risco', 'EXPIRED', '2026-03-01', [entitlementValido('ent-1')]),
        assinatura('encerrada-2-sem-risco', 'CANCELLED', '2026-01-01', []),
      ],
      AGORA,
    );

    expect(veredito.tipo).toBe('CONSOLIDAR');
    if (veredito.tipo === 'CONSOLIDAR') {
      const porId = new Map(veredito.encerrar.map((e) => [e.assinaturaId, e.entitlementParaMigrar]));
      expect(porId.get('encerrada-1-com-risco')).toBe('ent-1');
      expect(porId.get('encerrada-2-sem-risco')).toBeNull();
    }
  });
});
