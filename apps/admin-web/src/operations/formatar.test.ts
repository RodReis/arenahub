import { describe, expect, it } from 'vitest';

import {
  ROTULO_DE_RAZAO,
  ROTULO_DE_SEVERIDADE,
  estaSilencioso,
  idadeLegivel,
  instanteLegivel,
  traduzir,
} from './formatar';

const AGORA = new Date('2026-08-16T12:00:00.000Z');

describe('idade legível', () => {
  it('mostra segundos no primeiro minuto', () => {
    expect(idadeLegivel('2026-08-16T11:59:30.000Z', AGORA)).toBe('há 30s');
  });

  it('vira minutos depois de 60s', () => {
    expect(idadeLegivel('2026-08-16T11:55:00.000Z', AGORA)).toBe('há 5 min');
  });

  it('vira horas depois de 60 min', () => {
    expect(idadeLegivel('2026-08-16T09:00:00.000Z', AGORA)).toBe('há 3h');
  });

  it('vira dias depois de 24h', () => {
    expect(idadeLegivel('2026-08-14T12:00:00.000Z', AGORA)).toBe('há 2d');
  });

  it('diz "nunca" quando não há instante', () => {
    // Diferente de "há muito tempo": um Edge que nunca bateu é caso novo de
    // instalação, não equipamento que caiu.
    expect(idadeLegivel(null, AGORA)).toBe('nunca');
  });

  it('não mostra idade negativa quando o relógio do navegador está adiantado', () => {
    // "há -3 segundos" pareceria defeito da tela, não do relógio da máquina.
    expect(idadeLegivel('2026-08-16T12:00:05.000Z', AGORA)).toBe('agora');
  });

  it('não quebra com instante inválido', () => {
    expect(idadeLegivel('não-é-data', AGORA)).toBe('—');
  });
});

describe('silêncio', () => {
  it('considera saudável dentro de 90s', () => {
    expect(estaSilencioso('2026-08-16T11:59:00.000Z', AGORA)).toBe(false);
  });

  it('considera silencioso acima de 90s', () => {
    expect(estaSilencioso('2026-08-16T11:58:00.000Z', AGORA)).toBe(true);
  });

  it('trata ausência de heartbeat como silêncio', () => {
    expect(estaSilencioso(null, AGORA)).toBe(true);
  });

  it('trata instante inválido como silêncio -- na dúvida, alerta', () => {
    expect(estaSilencioso('lixo', AGORA)).toBe(true);
  });
});

describe('dicionários', () => {
  it('traduz as oito razões do ADR-024', () => {
    const codigos = [
      'ACTIVE_ENTITLEMENT',
      'MANUAL_OVERRIDE',
      'NO_ENTITLEMENT',
      'WRONG_UNIT',
      'OUTSIDE_SCHEDULE',
      'STUDENT_BLOCKED',
      'STUDENT_INACTIVE',
      'ADMIN_BLOCK',
    ];

    for (const codigo of codigos) {
      expect(ROTULO_DE_RAZAO[codigo]).toBeDefined();
      expect(ROTULO_DE_RAZAO[codigo]).not.toBe(codigo);
    }
  });

  it('distingue "sem plano" de "plano de outra unidade"', () => {
    // O ADR-024 separou as duas razões porque pedem ações opostas na
    // recepção. Se a tela usasse a mesma frase, a separação teria sido em vão.
    expect(ROTULO_DE_RAZAO['NO_ENTITLEMENT']).not.toBe(ROTULO_DE_RAZAO['WRONG_UNIT']);
  });

  it('descreve o que aconteceu, não acusa o aluno', () => {
    expect(ROTULO_DE_RAZAO['WRONG_UNIT']).toContain('outra unidade');
  });

  it('traduz severidade', () => {
    expect(ROTULO_DE_SEVERIDADE['CRITICAL']).toBe('Crítico');
  });

  it('cai para o próprio código quando não conhece', () => {
    // Valor novo do servidor aparece feio mas correto. Mostrar "—" esconderia
    // justamente o caso que ninguém previu.
    expect(traduzir(ROTULO_DE_RAZAO, 'PAYMENT_OVERDUE')).toBe('PAYMENT_OVERDUE');
  });
});

describe('instante legível', () => {
  it('formata no fuso de Brasília', () => {
    // 17:00Z = 14:00 em São Paulo.
    expect(instanteLegivel('2026-08-16T17:00:00.000Z')).toContain('14:00');
  });

  it('devolve travessão para nulo', () => {
    expect(instanteLegivel(null)).toBe('—');
  });
});
