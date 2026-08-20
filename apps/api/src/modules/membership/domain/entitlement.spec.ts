import { describe, expect, it } from '@jest/globals';

import type { StatusDeAluno } from '../../students/domain/student.js';
import {
  direitoEhEfetivo,
  montarSnapshotDePolitica,
  montarSnapshotDeVinculo,
  TRANSICOES_DE_ENTITLEMENT,
  transicionarEntitlement,
  TransicaoDeEntitlementInvalidaError,
  type DireitoDeAcesso,
  type StatusDeEntitlement,
} from './entitlement.js';
import type { JanelaDeAcesso } from './plan.js';

const UNIDADE = '11111111-1111-1111-1111-111111111111';
const OUTRA_UNIDADE = '22222222-2222-2222-2222-222222222222';
const SP = 'America/Sao_Paulo';

const TODOS_STATUS: StatusDeEntitlement[] = [
  'SCHEDULED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
];

/** Segunda-feira, 08:00-18:00 local. */
const JANELA_SEGUNDA: JanelaDeAcesso[] = [
  { gymUnitId: UNIDADE, dayOfWeek: 1, startMinute: 480, endMinute: 1080 },
];

function direito(sobrescrever: Partial<DireitoDeAcesso> = {}): DireitoDeAcesso {
  return {
    status: 'ACTIVE',
    startsAt: new Date('2026-08-01T00:00:00Z'),
    endsAt: new Date('2026-09-01T00:00:00Z'),
    janelas: JANELA_SEGUNDA,
    ...sobrescrever,
  };
}

/** 2026-08-17 e segunda; 13:00Z = 10:00 local, dentro da janela. */
const DENTRO = new Date('2026-08-17T13:00:00Z');

describe('transicionarEntitlement', () => {
  it('aceita toda transicao declarada', () => {
    for (const atual of TODOS_STATUS) {
      for (const alvo of TRANSICOES_DE_ENTITLEMENT[atual]) {
        expect(transicionarEntitlement(atual, alvo)).toBe(alvo);
      }
    }
  });

  it('recusa toda transicao ausente da tabela, com codigo estavel', () => {
    for (const atual of TODOS_STATUS) {
      const permitidos = TRANSICOES_DE_ENTITLEMENT[atual];

      for (const alvo of TODOS_STATUS.filter((s) => !permitidos.has(s))) {
        try {
          transicionarEntitlement(atual, alvo);
          throw new Error('deveria ter lancado');
        } catch (erro) {
          expect(erro).toBeInstanceOf(TransicaoDeEntitlementInvalidaError);
          expect((erro as TransicaoDeEntitlementInvalidaError).code).toBe(
            'ENTITLEMENT_INVALID_TRANSITION',
          );
        }
      }
    }
  });

  /** `CONVENTION.md` 3.3: SUSPENDED e reversivel, REVOKED e terminal. */
  it('permite retomar de SUSPENDED e nunca de REVOKED', () => {
    expect(transicionarEntitlement('SUSPENDED', 'ACTIVE')).toBe('ACTIVE');
    expect(TRANSICOES_DE_ENTITLEMENT.REVOKED.size).toBe(0);
    expect(TRANSICOES_DE_ENTITLEMENT.EXPIRED.size).toBe(0);
  });
});

describe('direitoEhEfetivo', () => {
  it('aceita direito ativo, no prazo, na unidade e dentro da janela', () => {
    expect(direitoEhEfetivo(direito(), 'ACTIVE', UNIDADE, SP, DENTRO)).toEqual({
      efetivo: true,
    });
  });

  /**
   * INV-033 e `M1-BR-002`. A guarda vem PRIMEIRO: aluno inelegivel nao
   * recebe acesso nem com direito perfeito -- inclusive cortesia.
   */
  it('nega para aluno BLOCKED, CANCELLED ou ARCHIVED, ainda que o direito esteja perfeito', () => {
    for (const status of ['BLOCKED', 'CANCELLED', 'ARCHIVED'] as StatusDeAluno[]) {
      expect(direitoEhEfetivo(direito(), status, UNIDADE, SP, DENTRO)).toEqual({
        efetivo: false,
        motivo: 'STUDENT_NOT_ELIGIBLE',
      });
    }
  });

  it('aceita para aluno LEAD, TRIAL, ACTIVE e SUSPENDED', () => {
    for (const status of ['LEAD', 'TRIAL', 'ACTIVE', 'SUSPENDED'] as StatusDeAluno[]) {
      expect(direitoEhEfetivo(direito(), status, UNIDADE, SP, DENTRO).efetivo).toBe(true);
    }
  });

  it('nega quando o entitlement nao esta ACTIVE', () => {
    for (const status of TODOS_STATUS.filter((s) => s !== 'ACTIVE')) {
      expect(direitoEhEfetivo(direito({ status }), 'ACTIVE', UNIDADE, SP, DENTRO)).toEqual({
        efetivo: false,
        motivo: 'ENTITLEMENT_NOT_ACTIVE',
      });
    }
  });

  it('nega antes de comecar', () => {
    const resultado = direitoEhEfetivo(
      direito({ startsAt: new Date('2026-08-18T00:00:00Z') }),
      'ACTIVE',
      UNIDADE,
      SP,
      DENTRO,
    );

    expect(resultado).toEqual({ efetivo: false, motivo: 'ENTITLEMENT_NOT_STARTED' });
  });

  /**
   * INV-035, o invariante mais importante desta fatia. A guarda e por DATA,
   * nao por status: um job de expiracao atrasado deixa o status em ACTIVE, e
   * o direito vencido ainda assim nao pode passar.
   */
  it('nega direito vencido mesmo com status ACTIVE (job de expiracao atrasado)', () => {
    const resultado = direitoEhEfetivo(
      direito({ status: 'ACTIVE', endsAt: new Date('2026-08-10T00:00:00Z') }),
      'ACTIVE',
      UNIDADE,
      SP,
      DENTRO,
    );

    expect(resultado).toEqual({ efetivo: false, motivo: 'ENTITLEMENT_EXPIRED' });
  });

  it('trata startsAt como inclusivo e endsAt como exclusivo', () => {
    const inicio = new Date('2026-08-17T13:00:00Z');
    const fim = new Date('2026-08-17T14:00:00Z');
    const janelaAmpla: JanelaDeAcesso[] = [
      { gymUnitId: UNIDADE, dayOfWeek: 1, startMinute: 0, endMinute: 1440 },
    ];

    expect(
      direitoEhEfetivo(
        direito({ startsAt: inicio, endsAt: fim, janelas: janelaAmpla }),
        'ACTIVE',
        UNIDADE,
        SP,
        inicio,
      ).efetivo,
    ).toBe(true);

    expect(
      direitoEhEfetivo(
        direito({ startsAt: inicio, endsAt: fim, janelas: janelaAmpla }),
        'ACTIVE',
        UNIDADE,
        SP,
        fim,
      ),
    ).toEqual({ efetivo: false, motivo: 'ENTITLEMENT_EXPIRED' });
  });

  it('nega unidade ausente do snapshot', () => {
    expect(direitoEhEfetivo(direito(), 'ACTIVE', OUTRA_UNIDADE, SP, DENTRO)).toEqual({
      efetivo: false,
      motivo: 'UNIT_NOT_ALLOWED',
    });
  });

  it('nega fora da janela de horario', () => {
    // 2026-08-17T23:00Z = segunda 20:00 local, depois das 18:00.
    const resultado = direitoEhEfetivo(
      direito(),
      'ACTIVE',
      UNIDADE,
      SP,
      new Date('2026-08-17T23:00:00Z'),
    );

    expect(resultado).toEqual({ efetivo: false, motivo: 'OUTSIDE_ACCESS_WINDOW' });
  });

  it('nega em dia sem janela', () => {
    // 2026-08-18 e terca; a janela so cobre segunda.
    const resultado = direitoEhEfetivo(
      direito(),
      'ACTIVE',
      UNIDADE,
      SP,
      new Date('2026-08-18T13:00:00Z'),
    );

    expect(resultado).toEqual({ efetivo: false, motivo: 'OUTSIDE_ACCESS_WINDOW' });
  });

  /**
   * A ordem das guardas e contrato: a mais restritiva responde primeiro
   * (INV-034). Aluno arquivado com direito vencido reporta o ALUNO, nao a
   * validade -- senao a recepcao conserta a data e continua sem entender por
   * que nao entra.
   */
  it('reporta a razao mais restritiva quando varias falham', () => {
    const resultado = direitoEhEfetivo(
      direito({ status: 'REVOKED', endsAt: new Date('2026-01-01T00:00:00Z') }),
      'ARCHIVED',
      OUTRA_UNIDADE,
      SP,
      DENTRO,
    );

    expect(resultado).toEqual({ efetivo: false, motivo: 'STUDENT_NOT_ELIGIBLE' });
  });
});

describe('montarSnapshotDePolitica', () => {
  it('congela plano, unidades e janelas com versao de formato', () => {
    const snapshot = montarSnapshotDePolitica('plano-1', 'Mensal', [UNIDADE], JANELA_SEGUNDA);

    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.planId).toBe('plano-1');
    expect(snapshot.gymUnitIds).toEqual([UNIDADE]);
  });

  /** Deterministico: mesma entrada, mesmo snapshot, em qualquer ordem. */
  it('ordena as unidades para o snapshot ser comparavel', () => {
    const a = montarSnapshotDePolitica('p', 'n', [OUTRA_UNIDADE, UNIDADE], []);
    const b = montarSnapshotDePolitica('p', 'n', [UNIDADE, OUTRA_UNIDADE], []);

    expect(a.gymUnitIds).toEqual(b.gymUnitIds);
  });

  it('nao muta a lista recebida', () => {
    const unidades = [OUTRA_UNIDADE, UNIDADE];
    montarSnapshotDePolitica('p', 'n', unidades, []);

    expect(unidades[0]).toBe(OUTRA_UNIDADE);
  });
});

describe('montarSnapshotDeVinculo', () => {
  it('monta snapshot sem plano, com janela livre', () => {
    const snapshot = montarSnapshotDeVinculo('STAFF', ['unidade-1']);

    expect(snapshot.planId).toBeNull();
    expect(snapshot.planName).toBe('Vinculo STAFF');
    expect(snapshot.gymUnitIds).toEqual(['unidade-1']);
    // Sete dias, do primeiro ao ultimo minuto: vinculo nao tem horario.
    expect(snapshot.janelas).toHaveLength(7);
    expect(snapshot.janelas[0]).toEqual({
      gymUnitId: 'unidade-1',
      dayOfWeek: 1,
      startMinute: 0,
      endMinute: 1440,
    });
  });

  it('cobre todas as unidades informadas', () => {
    const snapshot = montarSnapshotDeVinculo('TRAINER', ['u1', 'u2']);

    expect(snapshot.janelas).toHaveLength(14);
  });
});
