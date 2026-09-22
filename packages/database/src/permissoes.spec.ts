import { describe, expect, it } from 'vitest';

import {
  PAPEIS_DE_SISTEMA,
  PERMISSOES_DA_RECEPCAO,
  PERMISSOES_DO_FINANCEIRO,
  PERMISSOES_DO_MANAGER,
  PERMISSOES_DO_OWNER,
  PERMISSOES_DO_PROFESSOR,
} from './permissoes.js';

/**
 * Os cinco perfis prontos -- F80.
 *
 * O QUE ESTES TESTES PROVAM nao e "a lista tem os itens que escrevi" (isso
 * seria copiar o codigo para o teste e chamar de verificacao). Eles provam as
 * AUSENCIAS que sao decisao de produto e as invariantes que uma edicao futura
 * quebraria sem perceber.
 */
describe('perfis de sistema', () => {
  const TODAS = new Set(PERMISSOES_DO_OWNER);

  it('nenhum perfil concede permissao que o OWNER nao tem', () => {
    /*
     * O OWNER e o teto por construcao. Um perfil com codigo fora dele seria
     * permissao que o DONO da academia nao consegue exercer -- ou, pior, um
     * codigo escrito errado, que o banco aceita (o catalogo `Permission` e
     * criado por `upsert`) e que nunca autoriza nada.
     */
    for (const papel of PAPEIS_DE_SISTEMA) {
      for (const codigo of papel.permissoes) {
        expect(TODAS.has(codigo), `${papel.name} concede ${codigo}, fora do OWNER`).toBe(true);
      }
    }
  });

  it('nenhum perfil repete permissao', () => {
    for (const papel of PAPEIS_DE_SISTEMA) {
      expect(new Set(papel.permissoes).size, `${papel.name} tem codigo repetido`).toBe(
        papel.permissoes.length,
      );
    }
  });

  it('os cinco nomes sao distintos -- `@@unique([tenantId, name])` no schema', () => {
    const nomes = PAPEIS_DE_SISTEMA.map((p) => p.name);

    expect(new Set(nomes).size).toBe(nomes.length);
  });

  describe('gerente', () => {
    it('nao gerencia usuario nem papel -- quem decide quem entra e o dono', () => {
      expect(PERMISSOES_DO_MANAGER).not.toContain('user.manage');
      expect(PERMISSOES_DO_MANAGER).not.toContain('role.assign');
    });

    it('nao desliga o scoring de retencao -- afeta a academia inteira', () => {
      expect(PERMISSOES_DO_MANAGER).not.toContain('retention.kill_switch');
    });

    it('tem todo o RESTO do OWNER -- deriva por subtracao, nao por copia', () => {
      /*
       * A prova de que a derivacao e por `filter`: permissao nova no catalogo
       * entra no gerente sozinha. Se alguem trocar por lista literal, este
       * teste cai na primeira permissao adicionada -- que e exatamente quando
       * a divergencia comecaria a existir calada.
       */
      const esperado = PERMISSOES_DO_OWNER.filter(
        (c) => !['user.manage', 'role.assign', 'retention.kill_switch'].includes(c),
      );

      expect(PERMISSOES_DO_MANAGER).toEqual(esperado);
    });
  });

  describe('recepcao', () => {
    it('acha a fatura de um aluno, mas NAO ve o painel financeiro', () => {
      // Decisao do PI em 25/08/2026, registrada no proprio catalogo.
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.read');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('billing.dashboard');
    });

    it('ANEXA laudo sem LER dado de saude (ADR-039)', () => {
      expect(PERMISSOES_DA_RECEPCAO).toContain('health.upload');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('health.read');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('health.assess');
    });

    it('inscreve biometria sem ler nem revogar template', () => {
      expect(PERMISSOES_DA_RECEPCAO).toContain('biometric.enroll');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('biometric.read');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('biometric.revoke');
    });

    it('nao libera catraca a mao nem estorna', () => {
      // Atos excepcionais: ambos exigem motivo gravado e nao sao de balcao.
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('access.override');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('billing.refund');
    });
  });

  describe('financeiro', () => {
    it('ve o painel gerencial -- e o oposto da recepcao', () => {
      expect(PERMISSOES_DO_FINANCEIRO).toContain('billing.dashboard');
    });

    it('LE o aluno para cobrar, mas nao cadastra nem edita', () => {
      expect(PERMISSOES_DO_FINANCEIRO).toContain('student.read');
      expect(PERMISSOES_DO_FINANCEIRO).not.toContain('student.create');
      expect(PERMISSOES_DO_FINANCEIRO).not.toContain('student.update');
    });

    it('nao toca em biometria nem em dado de saude', () => {
      for (const codigo of PERMISSOES_DO_FINANCEIRO) {
        expect(codigo.startsWith('biometric.')).toBe(false);
        expect(codigo.startsWith('health.')).toBe(false);
      }
    });
  });

  describe('professor', () => {
    it('MEDE e explica a medicao -- o oposto da recepcao', () => {
      expect(PERMISSOES_DO_PROFESSOR).toContain('health.read');
      expect(PERMISSOES_DO_PROFESSOR).toContain('health.assess');
    });

    it('gerencia a grade de aulas', () => {
      expect(PERMISSOES_DO_PROFESSOR).toContain('class.manage');
    });

    it('nao toca em dinheiro', () => {
      for (const codigo of PERMISSOES_DO_PROFESSOR) {
        expect(codigo.startsWith('billing.')).toBe(false);
        expect(codigo.startsWith('receipt.')).toBe(false);
        expect(codigo.startsWith('reconciliation.')).toBe(false);
        expect(codigo).not.toBe('subscription.manage');
      }
    });

    it('nao cadastra aluno -- quem matricula e a recepcao', () => {
      expect(PERMISSOES_DO_PROFESSOR).not.toContain('student.create');
    });
  });

  describe('separacao entre perfis', () => {
    it('so o OWNER gerencia usuarios', () => {
      /*
       * A invariante que sustenta a fronteira da F79/F80: o Super Admin
       * entrega UM Admin, e so ele monta a equipe. Um segundo perfil com
       * `user.manage` abriria o convite a quem nao responde pela academia.
       */
      const comUserManage = PAPEIS_DE_SISTEMA.filter((p) =>
        p.permissoes.includes('user.manage'),
      ).map((p) => p.name);

      expect(comUserManage).toEqual(['OWNER']);
    });

    it('todo perfil enxerga o proprio tenant e as unidades', () => {
      // Sem isto o painel nao abre: o cabecalho le o tenant em toda tela.
      for (const papel of PAPEIS_DE_SISTEMA) {
        expect(papel.permissoes, `${papel.name} sem tenant.read`).toContain('tenant.read');
        expect(papel.permissoes, `${papel.name} sem unit.read`).toContain('unit.read');
      }
    });

    it('nenhum perfil alem do OWNER altera o cadastro do tenant ou cria unidade', () => {
      for (const papel of PAPEIS_DE_SISTEMA) {
        if (papel.name === 'OWNER' || papel.name === 'MANAGER') continue;

        expect(papel.permissoes, `${papel.name} altera o tenant`).not.toContain('tenant.update');
        expect(papel.permissoes, `${papel.name} cria unidade`).not.toContain('unit.create');
      }
    });
  });
});
