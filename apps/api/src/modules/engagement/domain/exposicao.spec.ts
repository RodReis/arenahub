import { describe, expect, it } from '@jest/globals';

import { NOME_ANONIMO, resolverExposicao } from './exposicao.js';

const base = {
  decisao: null,
  perfil: null,
  primeiroNome: 'Ana',
  statusDoAluno: 'ACTIVE' as const,
};

describe('resolverExposicao', () => {
  it('sem perfil e sem decisao, exibe o primeiro nome', () => {
    expect(resolverExposicao(base)).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('quem pediu para sair nao aparece', () => {
    const saiu = { ...base, decisao: { decision: 'REFUSED' as const, supersededAt: null } };
    expect(resolverExposicao(saiu)).toEqual({ exibe: false, motivo: 'OPT_OUT' });
  });

  it('aluno cancelado nao aparece, mesmo participando', () => {
    // A base legada do Pacto tem 1.926 CANCELLED (F47). Cancelado no telao
    // do saguao e vazamento com outro nome.
    const cancelado = { ...base, statusDoAluno: 'CANCELLED' as const };
    expect(resolverExposicao(cancelado)).toEqual({ exibe: false, motivo: 'ALUNO_INATIVO' });
  });

  it('apelido APROVADO aparece', () => {
    const perfil = { alias: 'Tigre', status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Tigre' });
  });

  it('apelido PENDENTE nao vaza -- cai no primeiro nome', () => {
    const perfil = { alias: 'Tigre', status: 'PENDING' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it.each(['REJECTED', 'HIDDEN'] as const)('apelido %s nao vaza', (status) => {
    const perfil = { alias: 'Tigre', status, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('quem escolheu anonimo aparece como Participante', () => {
    const perfil = { alias: null, status: 'APPROVED' as const, identidade: 'ANONIMO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: NOME_ANONIMO });
  });

  it('escolheu apelido mas o alias sumiu -- cai no primeiro nome, nao quebra', () => {
    const perfil = { alias: null, status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('opt-out vence a escolha de identidade', () => {
    const perfil = { alias: 'Tigre', status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    const saiu = { decision: 'REFUSED' as const, supersededAt: null };
    expect(resolverExposicao({ ...base, perfil, decisao: saiu })).toEqual({
      exibe: false,
      motivo: 'OPT_OUT',
    });
  });

  it('aluno inativo E fora do ranking reporta ALUNO_INATIVO -- a ordem dos dois if importa', () => {
    // test exists to trap if someone inverts the status check after opt-out check.
    // status priority must stay first: inactive students never appear, regardless of engagement decision.
    const cancelado = { ...base, statusDoAluno: 'CANCELLED' as const, decisao: { decision: 'REFUSED' as const, supersededAt: null } };
    expect(resolverExposicao(cancelado)).toEqual({ exibe: false, motivo: 'ALUNO_INATIVO' });
  });
});
