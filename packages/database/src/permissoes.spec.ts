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
    it('gerencia usuario e papel -- decisao do PI, 02/10/2026: a gerente administra a equipe', () => {
      expect(PERMISSOES_DO_MANAGER).toContain('user.manage');
      expect(PERMISSOES_DO_MANAGER).toContain('role.assign');
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
        (c) => !['retention.kill_switch', 'billing.settings.manage'].includes(c),
      );

      expect(PERMISSOES_DO_MANAGER).toEqual(esperado);
    });
  });

  describe('recepcao', () => {
    it('tem TUDO o do OWNER, menos o painel financeiro -- decisao do PI, 20/10/2026', () => {
      const esperado = PERMISSOES_DO_OWNER.filter((c) => c !== 'billing.dashboard');

      expect(PERMISSOES_DA_RECEPCAO).toEqual(esperado);
    });

    it('acha a fatura de um aluno, mas NAO ve o painel financeiro', () => {
      // Decisao do PI em 25/08/2026, registrada no proprio catalogo.
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.read');
      expect(PERMISSOES_DA_RECEPCAO).not.toContain('billing.dashboard');
    });

    it('recebe no balcao, emite o recibo e altera a cobranca', () => {
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.payment.manual');
      expect(PERMISSOES_DA_RECEPCAO).toContain('receipt.issue');
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.manage');
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.settings.manage');
    });

    it('adiciona e altera o plano do aluno e ve o time', () => {
      expect(PERMISSOES_DA_RECEPCAO).toContain('subscription.manage');
      expect(PERMISSOES_DA_RECEPCAO).toContain('team.read');
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
    it('billing.settings.manage: dono e recepcao tem; gerente e financeiro nao', () => {
      expect(PERMISSOES_DO_OWNER).toContain('billing.settings.manage');
      expect(PERMISSOES_DO_MANAGER).not.toContain('billing.settings.manage');
      expect(PERMISSOES_DO_FINANCEIRO).not.toContain('billing.settings.manage');
      expect(PERMISSOES_DA_RECEPCAO).toContain('billing.settings.manage');
    });

    it('OWNER, MANAGER e RECEPTION gerenciam usuarios; financeiro e professor nao', () => {
      /*
       * Era so o OWNER (F79/F80); em 02/10/2026 o PI deu a gerente. Em
       * 20/10/2026 deu a recepcao (tudo menos o painel financeiro).
       */
      const comUserManage = PAPEIS_DE_SISTEMA.filter((p) =>
        p.permissoes.includes('user.manage'),
      ).map((p) => p.name);

      expect(comUserManage).toEqual(['OWNER', 'MANAGER', 'RECEPTION']);
    });

    it('todo perfil enxerga o proprio tenant e as unidades', () => {
      // Sem isto o painel nao abre: o cabecalho le o tenant em toda tela.
      for (const papel of PAPEIS_DE_SISTEMA) {
        expect(papel.permissoes, `${papel.name} sem tenant.read`).toContain('tenant.read');
        expect(papel.permissoes, `${papel.name} sem unit.read`).toContain('unit.read');
      }
    });

    it('so OWNER, MANAGER e RECEPTION alteram o cadastro do tenant ou criam unidade', () => {
      for (const papel of PAPEIS_DE_SISTEMA) {
        if (['OWNER', 'MANAGER', 'RECEPTION'].includes(papel.name)) continue;

        expect(papel.permissoes, `${papel.name} altera o tenant`).not.toContain('tenant.update');
        expect(papel.permissoes, `${papel.name} cria unidade`).not.toContain('unit.create');
      }
    });
  });
});
