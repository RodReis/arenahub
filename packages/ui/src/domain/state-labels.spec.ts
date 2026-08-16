import { ALLOW_REASON, DENY_REASON } from '@arenahub/access-policy';
import { describe, expect, it } from 'vitest';

import { STATE_LABELS, stateLabel } from './state-labels.js';

describe('state-labels', () => {
  it('cobre TODA razao do motor -- codigo sem rotulo e badge vazio em producao', () => {
    const codigos = [...Object.values(ALLOW_REASON), ...Object.values(DENY_REASON)];

    for (const codigo of codigos) {
      expect(stateLabel('accessReason', codigo), `sem rotulo para ${codigo}`).toBeDefined();
    }
  });

  it('nao inventa codigo que o motor nao produz', () => {
    const conhecidos = new Set<string>([
      ...Object.values(ALLOW_REASON),
      ...Object.values(DENY_REASON),
    ]);

    for (const codigo of Object.keys(STATE_LABELS.accessReason)) {
      expect(conhecidos.has(codigo), `${codigo} nao existe em access-policy`).toBe(true);
    }
  });

  it('SUBSCRIPTION_OVERDUE nao existe -- inadimplencia chega como NO_ENTITLEMENT', () => {
    expect(stateLabel('accessReason', 'SUBSCRIPTION_OVERDUE')).toBeUndefined();
  });

  it('erro so para decisao deliberada; contornavel e atencao', () => {
    expect(stateLabel('accessReason', 'ADMIN_BLOCK')?.tone).toBe('danger');
    expect(stateLabel('accessReason', 'STUDENT_BLOCKED')?.tone).toBe('danger');
    expect(stateLabel('accessReason', 'NO_ENTITLEMENT')?.tone).toBe('danger');

    expect(stateLabel('accessReason', 'STUDENT_INACTIVE')?.tone).toBe('warning');
    expect(stateLabel('accessReason', 'WRONG_UNIT')?.tone).toBe('warning');
    expect(stateLabel('accessReason', 'OUTSIDE_SCHEDULE')?.tone).toBe('warning');
  });

  /**
   * REGRESSAO: estas sao as frases que JA estao em producao, em
   * `apps/admin-web/src/operations/formatar.ts:93-102`. A extracao nao pode
   * reescreve-las.
   *
   * O comentario da linha 90 de la explica por que elas ganham de rotulo
   * curto: "as frases dizem O QUE ACONTECEU, nao o que o sistema concluiu --
   * 'o plano vale em outra unidade' e acionavel; 'unidade errada' acusa o
   * aluno". Trocar por "Outra unidade" seria regressao de produto disfarcada
   * de melhoria de layout.
   */
  it('preserva byte a byte as frases que ja estao em producao', () => {
    expect(stateLabel('accessReason', 'ACTIVE_ENTITLEMENT')?.label).toBe('Plano válido');
    expect(stateLabel('accessReason', 'MANUAL_OVERRIDE')?.label).toBe(
      'Liberado manualmente pela recepção',
    );
    expect(stateLabel('accessReason', 'NO_ENTITLEMENT')?.label).toBe('Sem plano vigente');
    expect(stateLabel('accessReason', 'WRONG_UNIT')?.label).toBe('O plano vale em outra unidade');
    expect(stateLabel('accessReason', 'OUTSIDE_SCHEDULE')?.label).toBe('Fora do horário do plano');
    expect(stateLabel('accessReason', 'STUDENT_BLOCKED')?.label).toBe('Aluno bloqueado');
    expect(stateLabel('accessReason', 'STUDENT_INACTIVE')?.label).toBe('Cadastro não está ativo');
    expect(stateLabel('accessReason', 'ADMIN_BLOCK')?.label).toBe('Bloqueio administrativo');
  });

  it('LEAD continua "Interessado" -- o codigo venceu o contrato aqui', () => {
    // `DS-PAINEL.md` §7 escreve "Lead"; a tela ja diz "Interessado", que e
    // portugues e e o que a recepcao le. Frase de tela: o existente vence.
    expect(stateLabel('student', 'LEAD')?.label).toBe('Interessado');
  });

  /**
   * As DUAS unicas frases que mudam nesta fatia -- aprovadas pelo PI em
   * 16/08/2026.
   */
  it('NOT_APPLICABLE deixa de ser travessao', () => {
    // Era '—', que colapsava "equipamento nao confirma giro" com "dado
    // ausente" -- o oposto do que o §7 diz que este estado existe para
    // impedir.
    expect(stateLabel('passage', 'NOT_APPLICABLE')?.label).toBe('Não confirma giro');
  });

  it('RETRYING tem UM nome so, e e o do contrato', () => {
    // `devices/page.tsx:32-44` dizia "Tentando de novo"; o contrato §7 diz
    // "Tentando novamente". Duas telas, dois nomes, mesmo estado.
    expect(stateLabel('syncJob', 'RETRYING')?.label).toBe('Tentando novamente');
  });

  it('entitlement REVOKED e erro; biometric REVOKED e neutro', () => {
    expect(stateLabel('entitlement', 'REVOKED')?.tone).toBe('danger');
    expect(stateLabel('biometric', 'REVOKED')?.tone).toBe('neutral');
  });

  it('todo rotulo e pt-BR nao vazio', () => {
    for (const [maquina, estados] of Object.entries(STATE_LABELS)) {
      for (const [estado, rotulo] of Object.entries(estados)) {
        expect(rotulo.label.trim(), `${maquina}.${estado}`).not.toBe('');
      }
    }
  });

  it('estado desconhecido devolve undefined em vez de rotulo inventado', () => {
    expect(stateLabel('student', 'NAO_EXISTE')).toBeUndefined();
  });
});
