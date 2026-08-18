import { describe, expect, it } from '@jest/globals';

import {
  GrupoFamiliarInvalidoError,
  LIMITE_PADRAO_DE_MEMBROS,
  admitirMembro,
  membrosParaDerivarEntitlement,
  type MembroDoGrupo,
} from './grupo-familiar.js';

/**
 * Plano familiar: UMA assinatura, UMA invoice, N direitos de acesso.
 *
 * O modelo ja permitia isso e ninguem tinha notado: `Entitlement` tem
 * `studentId` PROPRIO e `subscriptionId` NULAVEL (schema.prisma). O motor de
 * acesso sempre leu o direito pelo aluno, nunca pela assinatura -- entao
 * familia nao precisa mexer em `Subscription.studentId` nem no motor de F9.
 * Uma assinatura passa a derivar N entitlements, um por membro.
 */
describe('admitirMembro', () => {
  const titular = { studentId: 'aluno-titular', role: 'HOLDER' as const };

  it('admite dependente enquanto ha vaga', () => {
    const grupo = admitirMembro([titular], { studentId: 'aluno-2', role: 'DEPENDENT' }, 3);
    expect(grupo).toHaveLength(2);
  });

  it('preenche as 3 vagas do plano familiar da Arena Positiva', () => {
    let grupo: readonly MembroDoGrupo[] = [titular];
    grupo = admitirMembro(grupo, { studentId: 'aluno-2', role: 'DEPENDENT' }, 3);
    grupo = admitirMembro(grupo, { studentId: 'aluno-3', role: 'DEPENDENT' }, 3);
    expect(grupo).toHaveLength(3);
  });

  it('recusa o 4o membro -- o limite e do plano, nao sugestao', () => {
    const cheio = [
      titular,
      { studentId: 'aluno-2', role: 'DEPENDENT' as const },
      { studentId: 'aluno-3', role: 'DEPENDENT' as const },
    ];
    expect(() => admitirMembro(cheio, { studentId: 'aluno-4', role: 'DEPENDENT' }, 3)).toThrow(
      GrupoFamiliarInvalidoError,
    );
  });

  it('recusa o mesmo aluno duas vezes no grupo', () => {
    expect(() => admitirMembro([titular], { studentId: 'aluno-titular', role: 'DEPENDENT' }, 3)).toThrow(
      GrupoFamiliarInvalidoError,
    );
  });

  it('recusa segundo titular -- quem paga e um so', () => {
    expect(() => admitirMembro([titular], { studentId: 'aluno-2', role: 'HOLDER' }, 3)).toThrow(
      GrupoFamiliarInvalidoError,
    );
  });

  it('nao muta o grupo recebido', () => {
    const grupo = [titular];
    admitirMembro(grupo, { studentId: 'aluno-2', role: 'DEPENDENT' }, 3);
    expect(grupo).toHaveLength(1);
  });

  it('limite padrao da familia e 3', () => {
    expect(LIMITE_PADRAO_DE_MEMBROS).toBe(3);
  });
});

describe('membrosParaDerivarEntitlement', () => {
  it('titular e dependentes recebem direito de acesso', () => {
    const grupo = [
      { studentId: 'aluno-titular', role: 'HOLDER' as const },
      { studentId: 'aluno-2', role: 'DEPENDENT' as const },
    ];
    expect(membrosParaDerivarEntitlement(grupo)).toEqual(['aluno-titular', 'aluno-2']);
  });

  it('assinatura individual deriva um unico direito', () => {
    expect(membrosParaDerivarEntitlement([{ studentId: 'so-ele', role: 'HOLDER' }])).toEqual([
      'so-ele',
    ]);
  });
});
